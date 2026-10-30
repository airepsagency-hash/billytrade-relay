# BillyTrade relay

A tiny service that reads three Binance endpoints from a region Binance accepts,
so BillyTrade can show real live prices.

## Routes
- `GET /health` - open, returns { ok: true }
- `GET /spot?symbol=BTCUSDT` - spot best bid/ask
- `POST /p2p` with `{ fiat, asset, tradeType, rows }` - P2P ads
- `GET /diag` - what this server's IP can reach

Every route except /health needs `Authorization: Bearer $RELAY_TOKEN`.

## Deploy on Render
Region: Frankfurt (EU). Runtime: Node. Start command: `npm start`.
Environment variable: `RELAY_TOKEN` (long random string).
