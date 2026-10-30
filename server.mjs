// BillyTrade relay — a tiny service that reaches Binance from an IP Binance accepts.
//
// It exposes ONLY three Binance reads (spot bookTicker, P2P ad search, a diagnostic
// probe). No arbitrary URL forwarding, so it cannot be abused as an open proxy.
// Every route except /health requires the shared token in RELAY_TOKEN.

import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const TOKEN = String(process.env.RELAY_TOKEN || "").trim();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const SPOT_BASES = [
  "https://data-api.binance.vision/api/v3",
  "https://api.binance.com/api/v3",
  "https://api-gcp.binance.com/api/v3",
];
const P2P_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
const FIAT_RE = /^[A-Z]{3}$/;
const ASSETS = new Set(["USDT", "BTC", "ETH", "BNB", "FDUSD", "USDC"]);
const TRADE_TYPES = new Set(["BUY", "SELL"]);
const TIMEOUT_MS = 9000;

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!TOKEN) return false;
  const raw = req.headers.authorization || "";
  const provided = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (provided.length !== TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i++) diff |= provided.charCodeAt(i) ^ TOKEN.charCodeAt(i);
  return diff === 0;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function fetchSpot(symbol) {
  let lastErr = null;
  for (const base of SPOT_BASES) {
    try {
      const res = await fetch(`${base}/ticker/bookTicker?symbol=${symbol}`, {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        lastErr = new Error(`spot ${symbol} ${res.status}`);
        continue;
      }
      const j = await res.json();
      if (j && (j.bidPrice || j.askPrice)) return j;
      lastErr = new Error(`spot ${symbol} vacío`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`spot ${symbol} falló`);
}

async function fetchP2pAds(fiat, asset, tradeType, rows) {
  const body = JSON.stringify({
    fiat,
    page: 1,
    rows,
    tradeType,
    asset,
    countries: [],
    payTypes: [],
    publisherType: null,
  });
  const res = await fetch(P2P_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      clienttype: "web",
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`p2p ${asset}/${fiat} ${tradeType} ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.data)) throw new Error(`p2p ${asset}/${fiat} ${tradeType} sin datos`);
  return data.data;
}

// Best real price for one side, ignoring promoted/pinned ads (unreliable as maker).
function summarize(ads, side) {
  const prices = [];
  for (const a of ads) {
    if (a?.privilegeType != null) continue;
    const p = Number(a?.adv?.price);
    if (!Number.isFinite(p) || p <= 0) continue;
    if (a?.adv?.tradeType === side) prices.push(p);
  }
  if (!prices.length) return { ads: 0, best: null };
  return {
    ads: prices.length,
    best: side === "BUY" ? Math.max(...prices) : Math.min(...prices),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true });
    }
    if (!authorized(req)) return send(res, 401, { ok: false, error: "unauthorized" });

    // GET /spot?symbol=BTCUSDT
    if (req.method === "GET" && url.pathname === "/spot") {
      const symbol = String(url.searchParams.get("symbol") || "").toUpperCase();
      if (!SYMBOL_RE.test(symbol)) return send(res, 400, { ok: false, error: "symbol inválido" });
      const ticker = await fetchSpot(symbol);
      return send(res, 200, ticker);
    }

    // POST /p2p  { fiat, asset, tradeType, rows }
    if (req.method === "POST" && url.pathname === "/p2p") {
      const body = await readJsonBody(req);
      const fiat = String(body.fiat || "").toUpperCase();
      const asset = String(body.asset || "").toUpperCase();
      const tradeType = String(body.tradeType || "").toUpperCase();
      const rows = Math.min(Math.max(Number(body.rows) || 10, 1), 20);
      if (!FIAT_RE.test(fiat)) return send(res, 400, { ok: false, error: "fiat inválido" });
      if (!ASSETS.has(asset)) return send(res, 400, { ok: false, error: "asset no permitido" });
      if (!TRADE_TYPES.has(tradeType))
        return send(res, 400, { ok: false, error: "tradeType inválido" });
      const ads = await fetchP2pAds(fiat, asset, tradeType, rows);
      return send(res, 200, { ok: true, data: ads });
    }

    // GET /diag — proves what this server's IP can actually reach on Binance.
    if (req.method === "GET" && url.pathname === "/diag") {
      const [btc, usdtBuy, usdtSell] = await Promise.allSettled([
        fetchSpot("BTCUSDT"),
        fetchP2pAds("COP", "USDT", "BUY", 10),
        fetchP2pAds("COP", "USDT", "SELL", 10),
      ]);
      return send(res, 200, {
        ok: true,
        spot:
          btc.status === "fulfilled"
            ? { btcUsdt: { bid: Number(btc.value.bidPrice), ask: Number(btc.value.askPrice) } }
            : { error: String(btc.reason?.message || btc.reason) },
        p2p: {
          "USDT/COP": {
            buy: usdtBuy.status === "fulfilled" ? summarize(usdtBuy.value, "BUY") : { error: String(usdtBuy.reason?.message || usdtBuy.reason) },
            sell: usdtSell.status === "fulfilled" ? summarize(usdtSell.value, "SELL") : { error: String(usdtSell.reason?.message || usdtSell.reason) },
          },
        },
      });
    }

    return send(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    return send(res, 502, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`relay escuchando en :${PORT}`);
});