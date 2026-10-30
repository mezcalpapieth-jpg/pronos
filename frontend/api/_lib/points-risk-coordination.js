import { binaryPrices, multiPrices } from './amm-math.js';

// Network-independent screen: fresh, low-activity accounts move an AMM price,
// then an established account buys the discounted side or sells the inflated side.
// Keep the exact fills for admin review; this never automatically penalizes users.
export const COORDINATION_QUERY = `
WITH fresh AS (
  SELECT u.username,u.created_at,COUNT(*) FILTER(WHERE t.side IN ('buy','sell')) AS actions,
    MIN(t.created_at) FILTER(WHERE t.side='buy') first_buy,
    COALESCE(SUM(t.collateral) FILTER(WHERE t.side='buy'),0) spend,
    COUNT(*) FILTER(WHERE t.side='sell') sells
  FROM points_users u JOIN points_trades t ON t.username=u.username
  WHERE u.created_at >= $1::timestamptz AND t.created_at >= $1::timestamptz
  GROUP BY u.username,u.created_at
  HAVING COUNT(*) FILTER(WHERE t.side IN ('buy','sell')) BETWEEN 1 AND 10
    AND COUNT(*) FILTER(WHERE t.side='sell')=0
    AND SUM(t.collateral) FILTER(WHERE t.side='buy') BETWEEN 100 AND 1200
    AND MIN(t.created_at) FILTER(WHERE t.side='buy') <= u.created_at + INTERVAL '5 minutes'
), donors AS (
  SELECT t.*,u.created_at signup_at FROM points_trades t JOIN fresh u ON u.username=t.username
  JOIN points_markets m ON m.id=t.market_id
  WHERE t.side='buy' AND t.created_at >= $1::timestamptz AND COALESCE(m.mode,'points')='points'
    AND t.reserves_before IS NOT NULL AND t.reserves_after IS NOT NULL
)
SELECT d.id AS donor_trade_id,d.username AS donor_username,d.signup_at,d.collateral AS donor_spend,
 d.market_id,d.outcome_index AS donor_outcome,d.created_at AS donor_at,d.reserves_before,d.reserves_after,
 b.id AS beneficiary_trade_id,b.username AS beneficiary,b.side AS beneficiary_side,
 b.outcome_index AS beneficiary_outcome,b.created_at AS beneficiary_at,m.question,
 r.referrer AS donor_referrer
FROM donors d
JOIN LATERAL (
 SELECT t.* FROM points_trades t
 WHERE t.market_id=d.market_id AND t.username<>d.username AND t.side IN ('buy','sell')
   AND t.created_at >= d.created_at AND t.created_at <= d.created_at + INTERVAL '5 minutes'
   AND NOT EXISTS(SELECT 1 FROM fresh f WHERE f.username=t.username)
   AND t.username <> $3
   AND ((t.side='sell' AND t.outcome_index=d.outcome_index) OR (t.side='buy' AND t.outcome_index<>d.outcome_index))
 ORDER BY t.created_at,t.id LIMIT 1
) b ON TRUE
JOIN points_markets m ON m.id=d.market_id
LEFT JOIN points_referrals r ON r.referred=d.username
WHERE ($2::text IS NULL OR b.username=$2 OR d.username=$2 OR r.referrer=$2)
ORDER BY b.created_at,d.id`;
function prices(value) {
  let reserves;
  try { reserves = typeof value === 'string' ? JSON.parse(value) : value; } catch { return []; }
  if (!Array.isArray(reserves) || reserves.length < 2 || reserves.some(n => !(Number(n) > 0))) return [];
  return reserves.length === 2 ? binaryPrices(reserves.map(Number)) : multiPrices(reserves.map(Number));
}
export function summarizeCoordinatedTrading(matches = []) {
  const groups = new Map();
  for (const row of matches) {
    const before = prices(row.reserves_before)[Number(row.beneficiary_outcome)];
    const after = prices(row.reserves_after)[Number(row.beneficiary_outcome)];
    const impact = row.beneficiary_side === 'buy' ? before - after : after - before;
    if (!Number.isFinite(impact) || impact < 0.005 || row.donor_username === row.beneficiary) continue;
    const key = `${row.beneficiary}:${row.market_id}:${row.beneficiary_side}:${row.beneficiary_outcome}:${new Date(row.beneficiary_at).toISOString()}`;
    const group = groups.get(key) || { username: row.beneficiary, marketId: Number(row.market_id), question: row.question,
      side: row.beneficiary_side, outcomeIndex: Number(row.beneficiary_outcome), beneficiaryTradeIds: [],
      tradedAt: row.beneficiary_at, donors: [], priceImpact: 0 };
    if (!group.beneficiaryTradeIds.includes(Number(row.beneficiary_trade_id))) group.beneficiaryTradeIds.push(Number(row.beneficiary_trade_id));
    if (!group.donors.some(d => d.tradeId === Number(row.donor_trade_id))) {
      group.donors.push({ username: row.donor_username, tradeId: Number(row.donor_trade_id), amount: Number(row.donor_spend),
        referrer: row.donor_referrer || null, createdAt: row.signup_at, tradedAt: row.donor_at,
        secondsBefore: Math.max(0,(Date.parse(row.beneficiary_at)-Date.parse(row.donor_at))/1000) });
      group.priceImpact += impact;
    }
    groups.set(key,group);
  }
  return [...groups.values()].map(group => ({ ...group,
    donorCount: new Set(group.donors.map(d=>d.username)).size,
    donorSpend: group.donors.reduce((sum,d)=>sum+d.amount,0),
    priceImpact: Math.round(group.priceImpact*10000)/10000,
  })).filter(group=>group.donorCount>=2).sort((a,b)=>b.donorCount-a.donorCount || Date.parse(b.tradedAt)-Date.parse(a.tradedAt));
}
export async function readCoordinatedTrading(db,{username=null,now=new Date()}={}) {
  const start = new Date(new Date(now).getTime()-30*86400000).toISOString();
  const result=await db.query(COORDINATION_QUERY,[start,username,process.env.POINTS_TREASURY_USERNAME || 'pronos_treasury']);
  return summarizeCoordinatedTrading(Array.isArray(result)?result:result.rows||[]);
}
export function coordinationScore(groups,username) {
  const own=groups.filter(g=>g.username===username);
  const markets=new Set(own.map(g=>g.marketId)).size;
  const donors=new Set(own.flatMap(g=>g.donors.map(d=>d.username))).size;
  return { coordinatedMarketCount: markets, coordinatedDonorCount: donors,
    coordinationRiskScore: Math.min(300, markets*20+donors*5) };
}
