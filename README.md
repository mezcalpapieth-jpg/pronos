# PRONOS — El mercado de predicciones de Latinoamérica

**¿México o Sudáfrica? Apuesta USDC en el partido inaugural del Mundial 2026.**

Prediction market on Base. Parimutuel settlement. 2% protocol fee. No custodians.

---

## Stack

| Layer | Tech |
|---|---|
| Smart contract | Solidity 0.8.20 (Foundry) |
| Chain | Base Sepolia (testnet) → Base Mainnet |
| USDC | Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Frontend | Vanilla HTML/CSS/JS + viem ESM |
| Admin tools | TypeScript + viem |

---

## Repo structure

```
pronos/
├── contracts/
│   ├── src/
│   │   └── PronoBet.sol          ← Main betting contract
│   ├── script/
│   │   ├── Deploy.s.sol          ← Deploy to Base Sepolia
│   │   ├── CloseBetting.s.sol    ← Close bets before kickoff
│   │   └── Resolve.s.sol         ← Set the final result
│   ├── test/
│   │   └── PronoBet.t.sol        ← Tests
│   └── foundry.toml
├── scripts/                       ← TypeScript admin tools
│   ├── config.ts
│   ├── check-market.ts
│   ├── close-betting.ts
│   └── resolve-market.ts
├── frontend/
│   └── index.html                ← Full frontend (no build step)
├── deployments.json              ← Fill after deploy
├── .env.example
└── README.md
```

---

## Setup

### 1. Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### 2. Clone the repo

```bash
git clone https://github.com/mezcalpapieth-jpg/pronos.git
cd pronos
```

### 3. Set up environment

```bash
cp .env.example .env
# Edit .env and fill in your PRIVATE_KEY
```

### 4. Install contract dependencies

```bash
cd contracts
forge install foundry-rs/forge-std
```

### 5. Run tests

```bash
cd contracts
forge test -vv
```

---

## Deploy to Base Sepolia

### Step 1: Deploy the contract

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast \
  -vvvv
```

The script prints the deployed `PronoBet` address. Copy it.

### Step 2: Update deployments.json

```json
{
  "PronoBet": "0xYOUR_CONTRACT_ADDRESS",
  "USDC": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "chainId": 84532
}
```

### Step 3: Update frontend/index.html

Find this line and replace the address:

```js
const PRONOS_BET_ADDRESS = '0x0000000000000000000000000000000000000000'; // TODO: fill after deploy
```

### Step 4: (Optional) Verify on Basescan

```bash
forge verify-contract \
  YOUR_CONTRACT_ADDRESS \
  src/PronoBet.sol:PronoBet \
  --verifier-url https://api-sepolia.basescan.org/api \
  --etherscan-api-key $BASESCAN_API_KEY \
  --chain-id 84532 \
  --constructor-args $(cast abi-encode "constructor(address,address)" 0x036CbD53842c5426634e7929541eC2318f3dCF7e YOUR_WALLET_ADDRESS)
```

---

## Admin workflow — Match day

### Before kickoff (~15 min)

Close betting so no new bets can be placed:

```bash
# Option A: Foundry script
cd contracts
PRONOS_BET_ADDRESS=0x... forge script script/CloseBetting.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast

# Option B: TypeScript
cd scripts && npm install
PRONOS_BET_ADDRESS=0x... npm run close
```

### After the match

Check current market state:

```bash
cd scripts
PRONOS_BET_ADDRESS=0x... npm run check
```

Resolve with the final result:

```bash
# OUTCOME: 1=Mexico, 2=Draw, 3=South Africa

# Option A: Foundry script
OUTCOME=1 PRONOS_BET_ADDRESS=0x... forge script script/Resolve.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast

# Option B: TypeScript (5-second countdown before broadcast)
cd scripts
OUTCOME=1 PRONOS_BET_ADDRESS=0x... npx ts-node resolve-market.ts
```

⚠️ **Resolution is permanent.** The script shows a 5-second countdown — press Ctrl+C to cancel.

---

## How payouts work

Pronos uses **parimutuel** settlement:

1. All USDC goes into a shared pool
2. A 2% protocol fee is deducted at resolution
3. Winners split the remaining pool proportionally to their bet

**Example:**
- Total pool: $1,000 USDC
- Mexico pool: $600 (60%)
- Draw pool: $250 (25%)
- SA pool: $150 (15%)
- Mexico wins → net pool = $980 (after 2% fee)
- Someone who bet $60 on Mexico gets: `$60 / $600 × $980 = $98` USDC

---

## Deploy frontend

The frontend is a single `frontend/index.html` — no build step required.

**Deploy to any static host:**

```bash
# Netlify Drop
# Just drag frontend/index.html to netlify.com/drop

# Vercel
npx vercel frontend/

# GitHub Pages
# Push to gh-pages branch, set root to /frontend
```

---

## Go to mainnet

1. Change `chainId` in `deployments.json` to `8453`
2. In `frontend/index.html`, change `baseSepolia` to `base` and update `RPC_URL` to `https://mainnet.base.org`
3. Change USDC address to `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
4. Redeploy with mainnet RPC:

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://mainnet.base.org \
  --private-key $PRIVATE_KEY \
  --broadcast \
  -vvvv
```

---

## Contract: PronoBet.sol

| Function | Who | When |
|---|---|---|
| `placeBet(outcome, amount)` | Users | Before kickoff |
| `claimWinnings()` | Winners | After resolution |
| `closeBetting()` | Admin | ~15min before kickoff |
| `resolve(outcome)` | Admin | After match ends |
| `collectFee()` | Admin | After resolution |
| `getMarketState()` | Frontend | Anytime |
| `getOdds()` | Frontend | Anytime |
| `estimatePayout(outcome, amount)` | Frontend | Anytime |

**Outcome encoding:** `1` = México · `2` = Empate · `3` = Sudáfrica

---

© 2026 Pronos · Built on Base
