# BillyTrade relay

Consulta Binance desde una IP que Binance acepta (la del sitio publicado está bloqueada).
Solo expone 3 lecturas: `/spot`, `/p2p` y `/diag`. Todas exigen el token salvo `/health`.

## Desplegar en Render (gratis, sin tarjeta)

1. Entra a https://dashboard.render.com/register y crea la cuenta (puedes usar GitHub).
2. Arriba a la derecha: **New +** → **Blueprint**.
3. Elige el repositorio **airepsagency-hash/billytrade-relay** y pulsa **Connect**.
   Render lee `render.yaml` y propone el servicio `billytrade-relay` en Frankfurt, plan Free.
4. Te pide el valor de **RELAY_TOKEN**: pega una cadena larga y aleatoria (por ejemplo 40 letras y números).
   Guárdala, la necesitarás también en la app.
5. Pulsa **Apply** / **Create**. Espera a que el estado sea **Live** (1-2 minutos).
6. Arriba verás la URL del servicio, tipo `https://billytrade-relay.onrender.com`.
   Ábrela con `/health` al final: debe responder `{"ok":true}`.

## Comprobar que Binance sí responde desde ahí

    curl -H "Authorization: Bearer TU_TOKEN" https://billytrade-relay.onrender.com/diag

- Si `p2p.USDT/COP.buy.ads` y `.sell.ads` son mayores que 0, el relay sirve.
- Si ambos traen `error` con 403 o "sin datos", Binance también bloquea esa IP y
  el relay no aporta nada (la app ya funciona con las fuentes alternativas).

## Nota sobre el plan gratuito

El servicio se duerme tras 15 minutos sin tráfico; la primera petición después
tarda hasta un minuto en despertarlo. Con la app abierta (refresco cada 30s) no se duerme.

## Conectar la app

En la app, los valores `BINANCE_RELAY_URL` (la URL base, sin barra final) y
`BINANCE_RELAY_TOKEN` (el mismo RELAY_TOKEN) se guardan como secretos.
Con ambos configurados la app consulta por el relay y cae a las fuentes directas si falla.
