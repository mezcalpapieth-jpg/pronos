// Deploy only committed onchain-sepolia source to the separate scheduler
// project. No credential is copied from the app checkout or environment files.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const [projectId, teamId] = process.argv.slice(2);
assert.match(projectId || '', /^prj_[A-Za-z0-9]+$/);
assert.equal(teamId, 'team_Ru2mJw1I6wlB1oAnSb5re7J0');
assert.notEqual(projectId, 'prj_Cq2kBrGtvtU7nVOH3T6yBGJWGRKi');
const repo = execFileSync('git', ['rev-parse','--show-toplevel'], { encoding:'utf8' }).trim();
const git = args => execFileSync('git', args, { cwd:repo, encoding:'utf8' });
const branch = git(['branch','--show-current']).trim();
assert.equal(branch, 'onchain-sepolia');
git(['diff','--exit-code','HEAD','--','ops/onchain-sepolia-indexer','frontend/api/_lib/protocol-event-indexer.js','frontend/api/_lib/protocol-schema.js']);
const sha = git(['rev-parse','HEAD']).trim();
const cli = process.env.VERCEL_CLI_PATH;
assert.ok(cli, 'Set VERCEL_CLI_PATH to the installed Vercel CLI entry point');
const project = JSON.parse(execFileSync(process.execPath,[cli,'api',`/v9/projects/${projectId}?teamId=${teamId}`,'--method','GET','--scope',teamId,'--non-interactive'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(project.name,'pronos-onchain-sepolia-indexer');
assert.equal(project.accountId,teamId);
const destination = join(tmpdir(),`pronos-sepolia-indexer-${sha}`);
await mkdir(destination,{recursive:true});
for (const path of git(['ls-files','ops/onchain-sepolia-indexer']).trim().split('\n')) {
  if (!path || path.endsWith('/.gitignore')) continue;
  const relative = path.slice('ops/onchain-sepolia-indexer/'.length);
  const target = join(destination,relative);
  await mkdir(join(target,'..'),{recursive:true});
  await writeFile(target,git(['show',`${sha}:${path}`]));
}
await mkdir(join(destination,'src'),{recursive:true});
for (const name of ['protocol-event-indexer.js','protocol-schema.js']) {
  await writeFile(join(destination,'src',name),git(['show',`${sha}:frontend/api/_lib/${name}`]));
}
await writeFile(join(destination,'source.json'),JSON.stringify({branch,sha}));
await mkdir(join(destination,'.vercel'),{recursive:true});
await writeFile(join(destination,'.vercel/project.json'),JSON.stringify({projectId,orgId:teamId,projectName:project.name}));
execFileSync(process.execPath,[cli,'deploy','--prod','--yes','--scope',teamId,'--meta',`githubCommitSha=${sha}`,'--meta',`githubCommitRef=${branch}`],{cwd:destination,stdio:'inherit'});
