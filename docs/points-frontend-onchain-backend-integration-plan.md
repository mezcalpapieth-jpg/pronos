# Integrar backend on-chain en el frontend de Points

## Recomendación

No conviene mover el frontend viejo del MVP hacia producción ni convertir mercados Points existentes en mercados on-chain. La ruta más limpia es usar el frontend actual de Points como producto principal y hacer que pueda renderizar/operar mercados con dos backends:

- `points`: ledger off-chain actual.
- `onchain`: protocolo Pronos en Arbitrum.

El objetivo eventual sí puede sentirse como un switch en admin, pero internamente debe ser un switch de destino al crear/desplegar mercados, no una mutación de mercados vivos con posiciones existentes.

## Estado actual útil

Ya hay piezas que acercan los dos mundos:

- Los mercados pueden tener `mode = points | onchain`.
- El API de mercados Points ya filtra por `mode`.
- El admin de pending markets ya contempla aprobar con metadata on-chain.
- El protocolo tiene endpoints propios para markets, market detail, buy, sell, redeem, positions, history, leaderboard y resolución.
- El payload on-chain ya se normaliza con categoría, traducciones, imágenes, tags, scores, resolver metadata y `mode: onchain`.
- El skeleton Bitso usa el protocolo sin tocar el ledger de Points, lo cual refuerza la separación correcta.

## Principio de arquitectura

Un mercado debe tener una especificación canónica y una o más ejecuciones.

Ejemplo:

```txt
canonical_market_spec
  -> points market execution
  -> onchain protocol execution
  -> partner venue listing
```

Eso permite que la pregunta, traducciones, imágenes, reglas, fuentes y resolución sean compartidas, mientras que cada ejecución mantiene su propio sistema de saldos, trades y liquidación.

## Trabajo necesario

### 1. Modelo de mercado compartido

Definir un shape público único que el frontend pueda consumir:

- `id`
- `canonicalId`
- `mode`
- `question`
- `translations`
- `outcomes`
- `prices`
- `liquidity`
- `category/tags`
- `imageUrl/outcomeImages`
- `startTime/endTime`
- `status`
- `resolver metadata`
- `execution`

`execution` debería contener lo que cambia por backend:

```json
{
  "mode": "onchain",
  "chainId": 42161,
  "poolAddress": "0x...",
  "protocolMarketId": "456",
  "collateralSymbol": "MXNB"
}
```

### 2. Adapter de frontend

Crear una capa interna tipo `marketClient`:

- `listMarkets({ mode, category, status })`
- `getMarket(id)`
- `quoteTrade({ market, side, outcome, amount })`
- `placeTrade(...)`
- `sellPosition(...)`
- `redeemPosition(...)`
- `getPortfolio({ mode })`
- `getHistory({ mode })`

El UI no debería saber si llama a `/api/points/*` o `/api/protocol/*`; solo debería pasar por el adapter.

### 3. Switch de admin

Agregar un control de destino al aprobar o crear mercado:

- `Points`
- `On-chain`
- `Both` más adelante

Reglas importantes:

- `Points` crea un mercado off-chain normal.
- `On-chain` crea/despliega un mercado de protocolo.
- `Both` crea dos ejecuciones vinculadas a la misma spec.
- Para mercados ya activos en Points, usar `Crear copia on-chain`, no `Convertir`.

Esto evita problemas con posiciones existentes, refunds, historial y balances.

### 4. Trading mode-aware

La tarjeta y el detalle pueden ser compartidos. El panel de trade cambia según `market.mode`.

Para `points`:

- saldo MXNP off-chain;
- buy/sell/refund en base de datos;
- historial Points;
- torneos/rewards existentes.

Para `onchain`:

- wallet/collateral;
- quotes del protocolo;
- buy/sell/redeem on-chain;
- indexer para posiciones/historial;
- estados de aprobación, gas y transacción.

### 5. Portfolio e historial

Hay dos opciones:

- Vista segmentada: tabs `Points` y `On-chain`.
- Vista unificada: mezclar posiciones pero mostrar claramente el tipo de saldo/liquidación.

Para el primer release conviene vista segmentada. La vista unificada puede venir después, cuando la contabilidad y UX de wallet estén más probadas.

### 6. Resolución y lifecycle

Points y on-chain deben compartir resolución conceptual, pero no la ejecución:

- Points resuelve/refundea en tablas Points.
- On-chain resuelve/cancela/disputa en contrato y luego indexa.

El admin debería mostrar ambos estados cuando exista un mercado con ejecuciones múltiples:

```txt
Spec: aprobada
Points: activo/resuelto/cancelado
On-chain: desplegado/activo/resuelto/disputado
```

### 7. Feature flag / rollout

Antes de enseñar on-chain a todos:

- mantenerlo detrás de flag;
- habilitarlo por categoría o allowlist;
- empezar con pocos mercados canary;
- verificar create -> trade -> index -> resolve -> redeem;
- agregar alertas para indexer, liquidity, failed txs y mercados expirados.

## Lo que no deberíamos hacer

- No migrar posiciones Points a on-chain automáticamente.
- No usar un switch global que cambie mercados activos de backend.
- No mantener dos frontends de producto compitiendo.
- No dejar que el UI mezcle saldos MXNP off-chain con collateral on-chain sin etiquetas claras.
- No exponer on-chain ampliamente hasta que indexer, resolución, redeem y support flow estén sólidos.

## Fases sugeridas

### Fase 1: contrato interno de datos

Unificar el shape de mercado que consumen cards, detail, trending, search y category pages.

### Fase 2: adapter de trade

Mover buy/sell/redeem/quote detrás de un adapter con dispatch por `mode`.

### Fase 3: admin destination

Agregar destino de aprobación/creación: Points u On-chain. Para mercados existentes, agregar `Crear copia on-chain`.

### Fase 4: beta on-chain en frontend Points

Mostrar mercados on-chain en una categoría o ruta controlada dentro del frontend Points.

### Fase 5: switch real

Cuando el backend on-chain esté listo, el switch puede decidir qué mercados se crean on-chain por default, mientras el producto sigue siendo el mismo frontend de Points.

## Decisión recomendada

Construir hacia un frontend único con adapters por backend.

En términos prácticos: Points sigue siendo la experiencia principal; el MVP/protocolo se integra por debajo como otro modo de ejecución. Así evitamos rehacer producto, preservamos lo que ya funciona, y dejamos listo el camino para que admin pueda elegir destino de mercado sin duplicar interfaces.
