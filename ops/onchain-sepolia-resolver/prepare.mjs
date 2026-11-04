// Creates a committed-source package only. Does not deploy or enable anything.
import { execFileSync } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { parseArgs } from 'node:util';
const {values}=parseArgs({options:{output:{type:'string'},target:{type:'string'},active:{type:'boolean'}}});
if(!values.output || !values.target)throw Error('explicit_output_and_preview_target_required');
const target=new URL(values.target);
if(target.protocol!=='https:' || !/^pronos-[a-z0-9]+-mezcalpapieth-jpgs-projects\.vercel\.app$/.test(target.hostname)
  || target.pathname!=='/api/cron/sepolia-resolve' || target.search || target.hash || target.username || target.password || target.port)throw Error('immutable_preview_target_required');
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
if(git(['branch','--show-current'])!=='onchain-sepolia'
  || git(['status','--porcelain','--','ops/onchain-sepolia-resolver','frontend/api/cron/sepolia-resolve.js','frontend/api/_lib']))throw Error('committed_sepolia_source_required');
const sha=git(['rev-parse','HEAD']),directory=resolve(values.output);
await mkdir(directory,{mode:0o700});
for(const file of ['worker.js','api/tick.js','package.json','build.mjs','vercel.json']) {
  const dest=join(directory,file);await mkdir(resolve(dest,'..'),{recursive:true,mode:0o700});
  let data=execFileSync('git',['show',`${sha}:ops/onchain-sepolia-resolver/${file}`],{encoding:'utf8'});
  if(file==='vercel.json') { const config=JSON.parse(data);config.crons=values.active?[{path:'/api/tick',schedule:'*/5 * * * *'}]:[];data=JSON.stringify(config,null,2)+'\n'; }
  await writeFile(dest,data,{flag:'wx',mode:0o600});
}
await writeFile(join(directory,'source.json'),JSON.stringify({branch:'onchain-sepolia',sha,mode:values.active?'active':'standby',target:target.href}),{flag:'wx',mode:0o600});
console.log(JSON.stringify({directory,sha,activePackage:Boolean(values.active),deployed:false,enabled:false}));
