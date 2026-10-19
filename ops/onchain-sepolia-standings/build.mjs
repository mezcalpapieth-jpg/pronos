import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const require=createRequire(import.meta.url);
const {build}=require('esbuild');
await build({entryPoints:[existsSync('src/sepolia-tournament-automation.js')?'src/sepolia-tournament-automation.js':'../../frontend/api/_lib/sepolia-tournament-automation.js'],outfile:'dist/automation.js',
  bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',nodePaths:[resolve('node_modules')]});
await mkdir('public',{recursive:true});
await writeFile('public/index.html','<!doctype html><title>Pronos Sepolia standings</title>Pronos Sepolia standings');
