import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DISPLAYABLE_SHARE_EPSILON } from '../_lib/points-position-visibility.js';
const source = await readFile(new URL('./claimable.js', import.meta.url),'utf8');
const statement=source.match(/const rows = await sql`([\s\S]+?)`;/)[1];
const values={scoringStartIso:'2026-10-01T15:00:00Z','session.username':'frmm',DISPLAYABLE_SHARE_EPSILON};
const args=[];const query=statement.replace(/\$\{([^}]+)\}/g,(_,key)=>{assert.ok(key in values,key);args.push(values[key]);return `$${args.length}`;});
test('badge SQL excludes dust, stale-cycle balances, dismissed/lost/onchain holdings and counts spendable winners',async()=>{
  const db=new PGlite();try{
    await db.exec(`CREATE TABLE points_markets(id int,status text,outcome int,mode text);
      CREATE TABLE points_positions(username text,market_id int,outcome_index int,shares numeric,dismissed_at timestamptz);
      CREATE TABLE points_trades(username text,market_id int,outcome_index int,shares numeric,side text,created_at timestamptz);
      INSERT INTO points_markets VALUES (1,'resolved',0,'points'),(2,'resolved',0,'points'),(3,'resolved',0,'points'),(4,'resolved',0,'points'),(5,'resolved',1,'points'),(6,'resolved',0,'onchain'),(7,'active',0,'points'),(8,'resolved',0,'points'),(9,'resolved',0,'points');
      INSERT INTO points_positions VALUES ('frmm',1,0,0.002158,NULL),('frmm',2,0,20,NULL),('frmm',3,0,100,NULL),('frmm',4,0,50,NOW()),('frmm',5,0,50,NULL),('frmm',6,0,50,NULL),('frmm',7,0,50,NULL),('frmm',8,0,5,NULL),('frmm',9,0,50,NULL);
      INSERT INTO points_trades SELECT 'frmm',id,0,50,'buy','2026-10-02T00:00Z' FROM points_markets WHERE id<>9;
      INSERT INTO points_trades VALUES ('frmm',1,0,49.997842,'sell','2026-10-03T00:00Z'),('frmm',3,0,50,'sell','2026-10-03T00:00Z'),('frmm',8,0,49.996,'sell','2026-10-03T00:00Z'),('frmm',9,0,50,'buy','2026-09-20T00:00Z');`);
    const result=await db.query(query,args);
    assert.equal(result.rows[0].count,1);assert.equal(Number(result.rows[0].payout),20);
  }finally{await db.close();}
});
