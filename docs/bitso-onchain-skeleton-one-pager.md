# Pronos x Bitso Onchain: Skeleton de integración

## Objetivo

Pronos está preparando una capa de integración para que mercados on-chain de Pronos puedan aparecer dentro de una experiencia tipo Bitso Onchain sin que Bitso tenga que forkear Polymarket ni asumir la creación/resolución de mercados.

La idea es simple:

- Pronos crea, cura, resuelve e indexa los mercados.
- Bitso puede leer mercados, precios, liquidez y posiciones desde Pronos.
- El usuario opera desde la wallet/stack de Bitso.
- Pronos devuelve transacciones listas para firmar, pero no custodia fondos del usuario ni ejecuta trades por Bitso.

## Qué adaptamos ya

Construimos un primer adapter de API pensado para partners on-chain:

```txt
https://pronos.io/api/partners/onchain
```

El skeleton expone:

- `GET /health`: capacidades, chain soportada, token de colateral y acciones disponibles.
- `GET /markets`: listado de mercados on-chain activos/resueltos/cancelados/disputados.
- `GET /markets/:marketId` y `GET /market?id=...`: detalle de un mercado.
- `POST /quote`: cotización de compra/venta antes de firmar.
- `POST /calldata`: transacciones listas para firmar: approval, buy, sell o redeem.
- `GET /positions?wallet=0x...`: posiciones indexadas por wallet.

## Qué recibe Bitso

Los mercados salen en un formato estable para partner, con:

- Pregunta en español e inglés.
- Opciones localizadas.
- Categoría, tags, horarios, liquidez, precios y estado.
- Dirección del pool, factory, chain id y versión de protocolo.
- Links públicos al mercado en Pronos y a la transacción en Arbiscan cuando aplica.
- Metadata de resolución: fuente, evento externo, score final y estado.

Ejemplo conceptual:

```json
{
  "id": "123",
  "venueMarketId": "pronos:42161:456",
  "poolAddress": "0x...",
  "chainId": 42161,
  "marketType": "binary",
  "status": "active",
  "tradable": true,
  "question": {
    "es": "¿Lloverá mañana en CDMX?",
    "en": "Will it rain tomorrow in Mexico City?"
  },
  "outcomes": [
    { "index": 0, "labels": { "es": "Sí", "en": "Yes" }, "price": 0.62 },
    { "index": 1, "labels": { "es": "No", "en": "No" }, "price": 0.38 }
  ]
}
```

## Flujo de trade

Para un trade, Bitso no necesita pedirle a Pronos que ejecute nada server-side.

1. Bitso muestra el mercado con datos de `/markets` o `/market`.
2. Bitso pide una cotización a `/quote`.
3. Bitso pide calldata a `/calldata`.
4. Pronos responde con una lista ordenada de transacciones:
   - aprobación ERC-20 si hace falta;
   - compra, venta o redeem en el AMM.
5. Bitso presenta esas transacciones en su wallet y el usuario firma.
6. El indexer de Pronos lee on-chain y actualiza precios, posiciones e historial.

Esto mantiene una separación clara:

- Bitso controla la experiencia de wallet y firma.
- Pronos controla mercado, pricing, resolución e indexación.
- El usuario conserva autocustodia durante la operación.

## Seguridad y límites actuales

El skeleton ya contempla:

- CORS para consumo desde partner.
- Rate limits por endpoint.
- Normalización estricta de inputs públicos.
- Sin ejecución server-side para trades de partner.
- Sin exposición de secretos ni llaves operativas.
- Separación entre mercados on-chain y el sistema off-chain de Points.

Este trabajo todavía es un skeleton de integración. Para producción faltaría validar con Bitso:

- formato exacto de transaction request esperado por su wallet;
- chain/collateral definitivos;
- si la ingesta será browser, server-to-server o ambas;
- identificador preferido de mercado;
- ambiente de staging compartido;
- criterios de listado, ordenamiento y deslistado de mercados.

## Estado

El adapter ya existe a nivel de código y está preparado para conectar con los mercados del protocolo Pronos. También dejamos pruebas básicas para validar que:

- los endpoints principales existen;
- los payloads tienen localización y metadata de venue;
- las transacciones devueltas son firmables por wallet;
- el partner flow no depende de custodia ni ejecución server-side de Pronos.

El siguiente paso ideal con Bitso es revisar el contrato de API y confirmar cómo quieren recibir mercados, quotes y transacciones firmables dentro de su producto.
