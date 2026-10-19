import { PGlite } from '@electric-sql/pglite';
import { fixture,addr,hash } from './sepolia-tournament-test-fixture.js';
import { planHash } from './sepolia-tournament.js';
import { buildTournamentSnapshot } from './sepolia-tournament-snapshot.js';
import { buildTournamentFinalScores,exportSeasonContext } from './sepolia-tournament-final.js';
import { SEPOLIA_TOURNAMENT_SCHEMA,tournamentStore } from './sepolia-tournament-store.js';

// Full canonical RPC fixture and a real local PostgreSQL schema, with no live
// environment loader, remote connection, signer or chain transaction.
export async function reviewFixture({final=false,planOptions={}}={}) {
  const f=fixture({resolved:final,planOptions:{startsAt:'2020-11-01T06:00:00Z',
    endsAt:final?'2020-12-01T06:00:00Z':'2099-12-01T06:00:00Z',...planOptions}});
  const plan=f.input.cycle.plan,start=Date.parse(plan.startsAt)/1000,end=Date.parse(plan.endsAt)/1000;
  f.block=n=>({number:n,hash:hash(n),timestamp:final&&n>=200?end-1+n-200:start+n-100});
  f.options.provider.getBlock=async n=>f.block(n);
  f.options.provider.getBlockNumber=async()=>final?202:201;
  f.input.final=final;
  const db=new PGlite(),sql=async(strings,...values)=>(await db.query(strings.reduce((q,s,i)=>q+(i?`$${i}`:'')+s,''),values)).rows;
  for(const ddl of SEPOLIA_TOURNAMENT_SCHEMA)await db.exec(ddl);
  await tournamentStore(sql).register(plan,planHash(plan));
  await db.exec("UPDATE sepolia_tournament_cycles SET status='funded'");
  await sql`INSERT INTO sepolia_tournament_mints(tx_hash,cycle_id,batch_index,owner_address,nonce,amount_units,signed_tx,status)
    VALUES(${hash(500)},${plan.cycleId},0,${plan.deployment.owner},1,${plan.totalUnits},'fixture-only','confirmed')`;
  await db.exec(`CREATE TABLE points_users(username text,wallet_address text,turnkey_sub_org_id text,
    api_blocked_at timestamptz,created_at timestamptz);
    CREATE TABLE points_account_reviews(username text,status text,updated_at timestamptz);
    CREATE TABLE points_markets(id int,parent_id int,chain_address text,start_time timestamptz,resolver_config jsonb,mode text,chain_id int);
    CREATE TABLE points_pending_markets(approved_market_id int,source_data jsonb);
    CREATE TABLE indexer_factory_state(chain_id int,factory_address text,last_block bigint);
    CREATE TABLE points_balances(username text,balance numeric);
    INSERT INTO points_balances VALUES('alice',12345);`);
  await sql`INSERT INTO points_users VALUES('alice',${addr(30)},'alice',NULL,'2020-10-01')`;
  for(const v of [1,2]) {
    await sql`INSERT INTO points_markets VALUES(${v+9},NULL,${addr(39+v)},NULL,NULL,'onchain',421614)`;
    await sql`INSERT INTO indexer_factory_state VALUES(421614,${addr(v+1)},200)`;
  }
  const artifact=await buildTournamentSnapshot(f.input,f.options),context=await exportSeasonContext(artifact,sql);
  const result=final?buildTournamentFinalScores({artifact,context,reviewedSnapshotHash:artifact.snapshotHash,
    reviewedContextHash:planHash(context),now:'2021-01-01'}):null;
  if(result)await sql`INSERT INTO sepolia_tournament_closures(cycle_id,plan_hash,result_hash,result)
    VALUES(${plan.cycleId},${planHash(plan)},${result.resultHash},${JSON.stringify(result)}::jsonb)`;
  return {...f,db,sql,plan,artifact,context,result};
}
