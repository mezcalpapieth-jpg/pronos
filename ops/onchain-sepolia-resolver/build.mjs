import { readFile,mkdir,writeFile } from 'node:fs/promises';
const source=JSON.parse(await readFile(new URL('./source.json',import.meta.url),'utf8'));
if(source.branch!=='onchain-sepolia' || !['active','standby'].includes(source.mode) || !/^[a-f0-9]{40}$/.test(source.sha))throw Error('reviewed_source_required');
await mkdir(new URL('./public/',import.meta.url),{recursive:true});
await writeFile(new URL('./public/index.html',import.meta.url),'<!doctype html><title>Pronos Sepolia resolver scheduler</title>Pronos Sepolia resolver scheduler');
