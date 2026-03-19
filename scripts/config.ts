import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { baseSepolia, base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ─── Load deployments ────────────────────────────────────────────────────────

const deploymentsPath = path.resolve(__dirname, "../deployments.json");
let deployments: { PronoBet: string; USDC: string; chainId: number };

try {
  deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
} catch {
  console.error("ERROR: deployments.json not found. Deploy contracts first.");
  process.exit(1);
}

// ─── Chain config ─────────────────────────────────────────────────────────────

const isMainnet = deployments.chainId === 8453;
const chain     = isMainnet ? base : baseSepolia;
const rpcUrl    = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";

// ─── Wallet ───────────────────────────────────────────────────────────────────

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  console.error("ERROR: PRIVATE_KEY not set in .env");
  process.exit(1);
}

export const account = privateKeyToAccount(
  (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`
);

export const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

export const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});

// ─── Contract ─────────────────────────────────────────────────────────────────

export const PRONOS_BET_ADDRESS = deployments.PronoBet as `0x${string}`;
export const USDC_ADDRESS       = deployments.USDC as `0x${string}`;

export const PRONOS_BET_ABI = parseAbi([
  // State reads
  "function bettingOpen() view returns (bool)",
  "function resolved() view returns (bool)",
  "function result() view returns (uint8)",
  "function totalPool() view returns (uint256)",
  "function outcomePool(uint8) view returns (uint256)",
  "function getOdds() view returns (uint256 mexicoPct, uint256 drawPct, uint256 saPct)",
  "function getMarketState() view returns (bool bettingOpen, bool resolved, uint8 result, uint256 totalPool, uint256 mexicoPool, uint256 drawPool, uint256 saPool)",
  "function getUserBets(address user) view returns (tuple(uint8 outcome, uint256 amount, bool claimed)[])",
  // Admin writes
  "function closeBetting() external",
  "function resolve(uint8 _result) external",
  "function collectFee() external",
  // Events
  "event BetPlaced(address indexed bettor, uint8 outcome, uint256 amount)",
  "event MarketResolved(uint8 result)",
  "event WinningsClaimed(address indexed bettor, uint256 payout)",
]);

export const OUTCOME_LABELS: Record<number, string> = {
  0: "PENDIENTE",
  1: "🇲🇽 México gana",
  2: "🤝 Empate",
  3: "🇿🇦 Sudáfrica gana",
};

export function formatUSDC(raw: bigint): string {
  return `$${(Number(raw) / 1e6).toFixed(2)} USDC`;
}
