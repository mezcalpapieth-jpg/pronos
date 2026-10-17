import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { assertPointsExecution, pointsExecutionLock } from './points-execution-mode.js';
import { executePointsBuy, executePointsSell } from './points-trading-service.js';
import { createLimitOrder, executeLimitOrderById } from './points-limit-orders.js';

const isExecutionError = error => error.status === 409 && error.message === 'onchain_market_requires_protocol';

test('legacy and explicit Points executions remain valid; other modes fail closed', () => {
  for (const mode of [undefined, null, 'points']) assert.equal(pointsExecutionLock({mode}), null);
  assert.throws(() => assertPointsExecution({mode:'onchain'}), isExecutionError);
  assert.throws(() => assertPointsExecution({mode:'unknown'}), {message:'unsupported_market_mode',status:409});
});

function marketOnlyClient({order = false} = {}) {
  const queries=[];
  return {
    queries,
    async query(text) {
      queries.push(text);
      if (order && queries.length === 1) {
        assert.match(text, /FROM points_limit_orders/);
        return {rows:[{id:1,market_id:7,status:'open',outcome_index:0}]};
      }
      assert.equal(queries.length, order ? 2 : 1, 'No balance, position, order or ledger work may follow');
      assert.match(text, /SELECT[\s\S]*m\.mode[\s\S]*FROM points_markets/);
      return {rows:[{id:7,mode:'onchain',status:'active'}]};
    },
  };
}

for (const [name, execute, args] of [
  ['buy',executePointsBuy,{collateral:1}],
  ['sell',executePointsSell,{shares:1}],
  ['limit order',createLimitOrder,{side:'buy',limitPrice:0.5,amount:1}],
]) {
  test(`Points ${name} rejects on-chain markets before touching balances or positions`, async () => {
    const client=marketOnlyClient();
    await assert.rejects(execute(client,{username:'preview-admin',marketId:7,outcomeIndex:0,...args}),isExecutionError);
    assert.equal(client.queries.length,1);
  });
}

test('an existing limit order cannot execute against an on-chain market', async () => {
  const client=marketOnlyClient({order:true});
  await assert.rejects(executeLimitOrderById(client,1),isExecutionError);
  assert.equal(client.queries.length,2);
});

for (const route of ['quote-buy','quote-sell','redeem']) {
  test(`Points ${route} returns 409 before quote math or settlement for on-chain markets`, async () => {
    const source=await readFile(new URL(`../points/${route}.js`,import.meta.url),'utf8');
    let queries=0;
    const market={id:7,mode:'onchain',status:'resolved',outcome:0};
    const query = async text => {
      queries++;
      assert.equal(queries,1,'No ledger or orderbook access may follow');
      assert.match(String(text), /SELECT[\s\S]*\bmode\b[\s\S]*FROM points_markets/);
      return {rows:[market]};
    };
    const context={
      applyCors:()=>null,rateLimit:()=>false,clientIp:()=> '127.0.0.1',
      ensurePointsSchema:async()=>{},schemaSql:{},
      requireSession:()=>({username:'preview-admin',sub:'preview-admin'}),
      pointsExecutionLock,assertPointsExecution,
      sql:async strings => (await query(strings.join(''))).rows,
      withTransaction:async fn=>fn({query}),
      TOURNAMENT_APPROVED_MARKET_START_ISO:'2026-08-01T00:00:00Z',console,
    };
    const handlerSource=source.slice(source.indexOf('export default async function handler')).replace('export default ','');
    const handler=vm.runInNewContext(`(${handlerSource})`,context);
    const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',body:{marketId:7,outcomeIndex:0,collateral:1,shares:1}},res);
    assert.equal(res.code,409);
    assert.equal(res.body.error,'onchain_market_requires_protocol');
    assert.equal(queries,1);
  });
}
