import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../cron/points-stock-snapshot.js';

test('scheduled stock valuation requires a cron secret and respects the disabled feature',async()=>{
  const secret=process.env.CRON_SECRET,enabled=process.env.POINTS_STOCKS_ENABLED;
  const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
  try {
    delete process.env.CRON_SECRET;const denied=response();
    await handler({method:'GET',headers:{}},denied);assert.equal(denied.statusCode,401);
    process.env.CRON_SECRET='test-only-cron';delete process.env.POINTS_STOCKS_ENABLED;
    const disabled=response();await handler({method:'GET',headers:{authorization:'Bearer test-only-cron'}},disabled);
    assert.equal(disabled.statusCode,200);assert.equal(disabled.body.skipped,'stocks_disabled');
  }finally{
    for(const [key,value]of[['CRON_SECRET',secret],['POINTS_STOCKS_ENABLED',enabled]])if(value==null)delete process.env[key];else process.env[key]=value;
  }
});
