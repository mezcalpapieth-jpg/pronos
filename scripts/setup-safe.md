# Safe Multisig Setup Guide for Pronos

## Overview
Two Safe multisig wallets are needed:
- **Admin Safe (3/5):** Owns MarketFactory, manages protocol settings
- **Resolver Safe (2/3):** Can resolve markets (separate from admin for security)

## Step 1: Create Admin Safe (3/5)

1. Go to [Safe on Base Sepolia](https://app.safe.global/new-safe/create?chain=basesep)
2. Connect your wallet
3. Add 5 signer addresses (your team wallets)
4. Set threshold to **3 of 5**
5. Deploy the Safe
6. Copy the Safe address

## Step 2: Create Resolver Safe (2/3)

1. Go to [Safe on Base Sepolia](https://app.safe.global/new-safe/create?chain=basesep)
2. Add 3 signer addresses (resolvers)
3. Set threshold to **2 of 3**
4. Deploy the Safe
5. Copy the Safe address

## Step 3: Transfer Ownership

After deploying the Pronos contracts:

```bash
# Set env vars
export ADMIN_SAFE=0x...      # Admin Safe address
export RESOLVER_SAFE=0x...   # Resolver Safe address
export FACTORY=0x...         # MarketFactory address

# Transfer factory ownership to Admin Safe
cast send $FACTORY "transferOwnership(address)" $ADMIN_SAFE \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $DEPLOYER_PRIVATE_KEY

# Set resolver to Resolver Safe
cast send $FACTORY "setResolver(address)" $RESOLVER_SAFE \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $DEPLOYER_PRIVATE_KEY
```

## Step 4: Verify

```bash
# Check owner
cast call $FACTORY "owner()(address)" --rpc-url $BASE_SEPOLIA_RPC
# Should return: $ADMIN_SAFE

# Check resolver
cast call $FACTORY "resolver()(address)" --rpc-url $BASE_SEPOLIA_RPC
# Should return: $RESOLVER_SAFE
```

## Step 5: Test Resolution Flow

1. Create a test market (via Admin Safe transaction in Safe UI)
2. Go to Safe UI > New Transaction > Transaction Builder
3. Enter MarketFactory address
4. Call `resolveMarket(uint256 marketId, uint8 outcome)`
5. 2 of 3 resolvers must sign
6. Execute transaction

## Notes
- For testnet, you can start with a single-owner Safe (1/1) to simplify testing
- Upgrade to 3/5 and 2/3 before mainnet
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Base Mainnet USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
