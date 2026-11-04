import {readFileSync,readdirSync,statSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const env=parseEnv(readFileSync('.env','utf8'));assert.equal(env.AI_PROVIDER,'mock');
for(const service of ['api','worker'])assert.equal(execFileSync('docker',['compose','exec','-T',service,'node','-e','process.stdout.write(process.env.AI_PROVIDER)'],{encoding:'utf8'}),'mock');
const logs=execFileSync('docker',['compose','logs','--no-color','api','worker'],{encoding:'utf8',maxBuffer:20000000});
for(const [key,value] of Object.entries(env))if(/PASSWORD|SECRET|KEY/.test(key)&&value.length>=16)assert(!logs.includes(value),'Configured secret found in logs');
assert(!/sk-or-v1-[A-Za-z0-9]{20}|Bearer [A-Za-z0-9_-]{40}/.test(logs),'Potential credential found in logs');
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0');assert(!tracked.some(p=>/(^|\/)\.env($|\.)/.test(p)&&!p.endsWith('.env.example')),'Secret environment file tracked');
function files(root){return readdirSync(root).flatMap(name=>{const p=`${root}/${name}`;return statSync(p).isDirectory()?files(p):[p];});}
for(const p of files('apps/web/dist'))assert(!/OPENROUTER_API_KEY|sk-or-v1-/.test(readFileSync(p,'utf8')),'Server key configuration in browser bundle');
for(const p of ['docs/MASTER_SPEC.md','docs/PHASE_0.md','docs/implementation-plan.md','docs/architecture.md','docs/database.md','docs/ai-workloads.md','docs/infrastructure.md','docs/interview-lifecycle.md'])assert.equal(readFileSync(p,'utf8'),execFileSync('git',['show',`HEAD:${p}`],{encoding:'utf8'}),'Approved specification changed');
console.log('PASS mock mode, configured-secret/log/browser checks, environment tracking and protected specifications');
