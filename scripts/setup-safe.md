# Safe Multisig Setup Guide for Pronos

## Overview
For testnet we keep operations simple. For mainnet we keep the stronger multisig split.

## Testnet: Arbitrum Sepolia 1/1

Use one single-owner Safe and reuse the same address as both `ADMIN_SAFE` and `RESOLVER_SAFE`.

### Step 1: Create one testnet Safe

1. Go to [Safe on Arbitrum Sepolia](https://app.safe.global/new-safe/create?chain=arbsep)
2. Connect your wallet
3. Add 1 owner address, your testnet admin wallet
4. Set threshold to **1 of 1**
5. Deploy the Safe
6. Copy the Safe address

### Step 2: Transfer ownership and resolver role

After deploying the Pronos contracts:

```bash
# Set env vars
export TESTNET_SAFE=0x...    # The 1/1 Safe address
export ADMIN_SAFE=$TESTNET_SAFE
export RESOLVER_SAFE=$TESTNET_SAFE
export FACTORY=0x...         # MarketFactory address on Arbitrum Sepolia

# Transfer factory ownership to Admin Safe
cast send $FACTORY "transferOwnership(address)" $ADMIN_SAFE \
  --rpc-url $ARB_SEPOLIA_RPC --private-key $DEPLOYER_PRIVATE_KEY

# Set resolver to Resolver Safe
cast send $FACTORY "setResolver(address)" $RESOLVER_SAFE \
  --rpc-url $ARB_SEPOLIA_RPC --private-key $DEPLOYER_PRIVATE_KEY
```

### Step 3: Verify

```bash
# Check owner
cast call $FACTORY "owner()(address)" --rpc-url $ARB_SEPOLIA_RPC
# Should return: $ADMIN_SAFE

# Check resolver
cast call $FACTORY "resolver()(address)" --rpc-url $ARB_SEPOLIA_RPC
# Should return: $RESOLVER_SAFE
```

### Step 4: Test Resolution Flow

1. Create a test market (via Admin Safe transaction in Safe UI)
2. Go to Safe UI > New Transaction > Transaction Builder
3. Enter MarketFactory address
4. Call `resolveMarket(uint256 marketId, uint8 outcome)`
5. The single testnet owner signs
6. Execute transaction

## Mainnet: Arbitrum One

Do not use the 1/1 setup for mainnet. Use two separate Safes:

- **Admin Safe (3/5):** Owns MarketFactory and manages protocol settings.
- **Resolver Safe (2/3):** Can resolve markets and should be separate from the admin Safe.

Mainnet creation steps:

1. Go to [Safe on Arbitrum One](https://app.safe.global/new-safe/create?chain=arb1)
2. Create the Admin Safe with 5 team owner addresses and threshold **3 of 5**
3. Create the Resolver Safe with 3 resolver addresses and threshold **2 of 3**
4. Set `ADMIN_SAFE` to the 3/5 Safe and `RESOLVER_SAFE` to the 2/3 Safe
5. Transfer MarketFactory ownership to `ADMIN_SAFE`
6. Set the factory resolver to `RESOLVER_SAFE`

## Notes
- Testnet: one 1/1 Safe is fine so we can move fast.
- Mainnet: keep separate 3/5 admin and 2/3 resolver Safes.
- Arbitrum Sepolia USDC: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
- Arbitrum One USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
