import {ethers} from 'ethers';
const wallet=new ethers.Wallet(`0x${'12'.repeat(32)}`),addr=n=>`0x${String(n).repeat(40)}`;
export const preview={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'onchain-sepolia',ONCHAIN_CHAIN_ID:'421614',
  ONCHAIN_PREVIEW_APPROVALS_ENABLED:'true',ONCHAIN_ADMIN_SETTLEMENT_ENABLED:'true',ONCHAIN_DURABLE_TRADES_ENABLED:'true',TURNKEY_POLICIES_ENABLED:'true',
  DATABASE_URL:'postgresql://pronos_writer:test@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',ONCHAIN_RPC_URL:'https://fixture.invalid',
  ONCHAIN_MARKET_FACTORY_ADDRESS:addr(1),ONCHAIN_MARKET_FACTORY_V2_ADDRESS:addr(2),ONCHAIN_COLLATERAL_ADDRESS:addr(3),
  ONCHAIN_RESOLVER_ADDRESS:wallet.address,ONCHAIN_RESOLVER_SUBORG_ID:'ops',ONCHAIN_OWNER_ADDRESS:wallet.address,ONCHAIN_OWNER_SUBORG_ID:'ops'};
