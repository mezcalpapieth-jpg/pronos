# Pronos Partner Venue API Skeleton

This is the draft integration surface for listing and trading Pronos markets inside a third-party on-chain terminal such as Bitso Onchain / Onchain.cc.

The API is intentionally venue-oriented:

- Pronos keeps market creation, resolution, indexing, and liquidity.
- The partner reads market data and quotes from Pronos.
- The partner wallet signs transactions directly using calldata returned by Pronos.
- Pronos does not custody partner users' funds and does not execute partner trades server-side.

Base URL:

```txt
https://pronos.io/api/partners/onchain
```

## Endpoints

### Health / Capabilities

```http
GET /health
```

Returns API version, supported actions, supported chains, collateral token, and dependency presence.

### Markets

```http
GET /markets?status=active&limit=100
GET /markets?status=all&category=deportes&chainId=42161
```

Returns active/resolved/canceled/disputed Pronos on-chain markets in a partner-stable schema. Markets include localized `question.es`, `question.en`, localized outcome labels, prices, liquidity, close time, resolver metadata, and web links.

### Market Detail

```http
GET /markets/:marketId
GET /market?id=:marketId
GET /market?poolAddress=0x...
```

Returns one market with resolution/rules metadata.

### Quote

```http
POST /quote
Content-Type: application/json

{
  "marketId": "123",
  "action": "buy",
  "outcomeIndex": 0,
  "collateral": 50
}
```

Sell quote:

```json
{
  "marketId": "123",
  "action": "sell",
  "outcomeIndex": 0,
  "shares": 10
}
```

### Calldata

```http
POST /calldata
Content-Type: application/json

{
  "marketId": "123",
  "action": "buy",
  "outcomeIndex": 0,
  "collateral": 50,
  "walletAddress": "0x...",
  "slippageBps": 200
}
```

Returns ordered transaction requests. For a buy, this may include:

1. `approve_collateral`, if allowance is unknown or insufficient.
2. `buy`, the AMM transaction.

The partner should present/sign/send these using its own wallet stack.

Supported `action` values:

- `buy`
- `sell`
- `redeem`

### Positions

```http
GET /positions?wallet=0x...
```

Returns indexed Pronos on-chain positions for a wallet, including outcome labels, shares, cost basis, current value, PnL estimate, and redeemability.

## Contract Model

The calldata endpoint returns transactions for the live AMM pool. Trading uses:

- ERC-20 `approve(spender, amount)` for the market pool when needed.
- AMM `buy(...)`, `sell(...)`, and `redeem(...)` on the market pool.

The current collateral metadata is returned from `/health` and in every envelope under `chain.collateral`.

## Open Questions For Bitso / Onchain

- Preferred market identifier: Pronos DB id, pool address, or `chainId:factory:marketId`.
- Expected category taxonomy and ranking fields.
- Whether they want browser CORS access from their terminal, server-to-server ingestion, or both.
- Their preferred transaction request format for approval and AMM calls.
- Whether they want websocket/polling deltas later for prices and trades.

