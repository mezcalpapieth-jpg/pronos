// Local-only staging harness. This is never imported by a deployed API route.
import http from 'node:http';
import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { ensureStockSchema } from '../_lib/stock-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import { createSessionToken, setSessionCookie } from '../_lib/session.js';
import { TOURNAMENT_STARTING_BALANCE } from '../_lib/points-tournament-config.js';

const hostname = new URL(process.env.DATABASE_URL).hostname;
if (!process.env.STOCK_STAGING_BRANCH_ID || !process.env.STOCK_STAGING_HOST || hostname !== process.env.STOCK_STAGING_HOST
    || new URL(process.env.DATABASE_READ_URL || process.env.DATABASE_URL).hostname !== hostname) throw new Error('An explicitly configured isolated staging database is required.');
if (process.env.VERCEL_ENV || process.env.POINTS_STOCKS_ENABLED !== 'true') throw new Error('This harness is local only and requires stocks enabled.');
const sql = neon(process.env.DATABASE_URL);
await ensurePointsSchema(sql); await ensureStockSchema(withTransaction);
const username = 'stocks_demo';
const suborgId = 'stock-staging-demo-local';
await sql.query(`INSERT INTO points_users(turnkey_sub_org_id,username,display_name,email) VALUES($1,$2,'Stocks demo','stocks-demo@example.invalid') ON CONFLICT DO NOTHING`, [suborgId, username]);
await sql.query(`INSERT INTO points_balances(username,balance) VALUES($1,$2) ON CONFLICT DO NOTHING`, [username, TOURNAMENT_STARTING_BALANCE]);
const reads = new Set(['stocks/assets','stocks/candles','stocks/positions','stocks/health','auth/me','positions','pnl-history','leaderboard','cycles/current','cycles/history','markets','market','parlays','limit-orders','claimable','history','maker-rewards','daily-status','pwa-install-status','referrals/stats','social-tasks/catalog']);
const writes = new Set(['stocks/quote','stocks/buy','stocks/sell','buy','sell']);
const handlers = new Map();
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/stock-staging/session' && req.method === 'GET') {
      setSessionCookie(res, createSessionToken({ suborgId, username, email: 'stocks-demo@example.invalid' }));
      res.writeHead(302, { Location: '/points/stocks' }); res.end(); return;
    }
    const route = url.pathname.replace(/^\/api\/points\//, '');
    if (!(req.method === 'GET' ? reads.has(route) : writes.has(route))) return json(res, 404, { error: 'staging_route_not_enabled' });
    if (!handlers.has(route)) handlers.set(route, (await import(new URL(`../points/${route}.js`, import.meta.url))).default);
    req.query = Object.fromEntries(url.searchParams);
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16000) return json(res, 413, { error: 'body_too_large' }); }
      req.body = body ? JSON.parse(body) : {};
    }
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
    await handlers.get(route)(req, res);
  } catch (error) {
    console.error('[stock staging]', { code: error.code, message: error.message });
    if (!res.headersSent) json(res, 500, { error: 'staging_request_failed' });
  }
});
server.listen(Number(process.env.STOCK_STAGING_PORT || 3180), '127.0.0.1', () => console.log(`Stock staging API on http://127.0.0.1:${server.address().port} (${hostname})`));
const snapshot = (await import('../cron/points-stock-snapshot.js')).default;
let collecting = false;
async function collect() {
  if (collecting) return; collecting = true;
  try {
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { console.log('[stock staging valuations]', this.statusCode, body); } };
    await snapshot({ method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res);
  } finally { collecting = false; }
}
await collect(); setInterval(collect, 60_000).unref();
