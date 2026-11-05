import {test} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,chmodSync,unlinkSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {provisionAuthorization,authorizationState,authorizedTransport,SYNTHETIC_APPROVAL} from '../../scripts/openrouter-verification/authorization.mjs';
import {consume} from '../../scripts/openrouter-verification/limit.mjs';
import {reconcile} from '../../scripts/openrouter-verification/evidence.mjs';
const temporary=()=>mkdtempSync(join(tmpdir(),'ga-remediation-'));
const options=task=>({method:'POST',redirect:'error',body:JSON.stringify({messages:[{},{content:JSON.stringify({correlationId:randomUUID()})}],response_format:{json_schema:{name:task.replaceAll('-','_')}}})});
const url='https://openrouter.ai/api/v1/chat/completions';
function child(mode,root,task='job-analysis',runName='display-only') {
 return new Promise(done=>{const p=spawn(process.execPath,[resolve('tests/openrouter/authorization-child.mjs'),mode,root,task,runName],{stdio:'ignore'});p.once('exit',done);});
}
test('GA-01/04 concurrent authorization initialization admits exactly one initializer',async()=>{
 const root=temporary();try {
  const results=await Promise.all(Array.from({length:12},()=>child('init',root)));
  assert.equal(results.filter(c=>c===0).length,1);assert.equal(results.filter(c=>c===2).length,11);
  assert.equal(authorizationState(root,SYNTHETIC_APPROVAL).consumed,0);
  const db=new DatabaseSync(join(root,'authorization.sqlite'));assert.throws(()=>db.exec("UPDATE identity SET authorization='changed'"));db.close();
  assert.throws(()=>provisionAuthorization(root,{...SYNTHETIC_APPROVAL,authorizationId:randomUUID()}));
 }finally{rmSync(root,{recursive:true});}
});
test('GA-01 alternate run names share exactly two admissions across concurrent restarted processes',async()=>{
 const root=temporary();try {
  provisionAuthorization(root,SYNTHETIC_APPROVAL);
  const results=await Promise.all(Array.from({length:12},(_,n)=>child('consume',root,n%2?'rubric-draft':'job-analysis',`run-${n}`)));
  assert.equal(results.filter(c=>c===0).length,2);
  for(const name of ['changed','another','new-name'])assert.equal(await child('consume',root,'job-analysis',name),2);
  assert.equal(authorizationState(root,SYNTHETIC_APPROVAL).consumed,2);
  assert.throws(()=>consume(join(root,'authorization.sqlite'),'job-analysis',randomUUID())); // synthetic-counter bypass
 }finally{rmSync(root,{recursive:true});}
});
test('GA-01 commit precedes callback; failed and ambiguous sends never refund',async()=>{
 const root=temporary();try {
  provisionAuthorization(root,SYNTHETIC_APPROVAL);let sends=0;
  const transport=authorizedTransport(root,SYNTHETIC_APPROVAL,async()=>{sends++;assert.equal(authorizationState(root,SYNTHETIC_APPROVAL).consumed,sends);throw new Error('synthetic timeout');});
  await assert.rejects(()=>transport(url,options('job-analysis')));await assert.rejects(()=>transport(url,options('rubric-draft')));
  await assert.rejects(()=>transport(url,options('job-analysis')));assert.equal(sends,2);
  assert.equal(authorizationState(root,SYNTHETIC_APPROVAL).consumed,2);
 }finally{rmSync(root,{recursive:true});}
});
test('GA-01 mismatched identity, missing state and corruption fail closed',async()=>{
 const root=temporary();try {
  provisionAuthorization(root,SYNTHETIC_APPROVAL);let sends=0;
  const changed=authorizedTransport(root,{...SYNTHETIC_APPROVAL,authorizationId:randomUUID()},async()=>{sends++;});
  await assert.rejects(()=>changed(url,options('job-analysis')));
  const valid=authorizedTransport(root,SYNTHETIC_APPROVAL,async()=>{sends++;});
  const path=join(root,'authorization.sqlite');unlinkSync(path);
  await assert.rejects(()=>valid(url,options('job-analysis')));
  writeFileSync(path,'corruption');await assert.rejects(()=>valid(url,options('job-analysis')));assert.equal(sends,0);
 }finally{rmSync(root,{recursive:true});}
});
test('GA-04 actual permission denied writes and inaccessible path fail before send',async()=>{
 assert.notEqual(process.getuid(),0,'This permission test must execute as an unprivileged user');
 const root=temporary();try {
  provisionAuthorization(root,SYNTHETIC_APPROVAL);const path=join(root,'authorization.sqlite');let sends=0;
  const transport=authorizedTransport(root,SYNTHETIC_APPROVAL,async()=>{sends++;});
  chmodSync(path,0o400);chmodSync(root,0o500);
  await assert.rejects(()=>transport(url,options('job-analysis')));assert.equal(sends,0);
  chmodSync(root,0o000);await assert.rejects(()=>transport(url,options('job-analysis')));assert.equal(sends,0);
  chmodSync(root,0o700);chmodSync(path,0o600);assert.equal(authorizationState(root,SYNTHETIC_APPROVAL).consumed,0);
 }finally{chmodSync(root,0o700);rmSync(root,{recursive:true});}
});
test('GA-04 real SQLite COMMIT failure rolls back and never calls transport',async()=>{
 const root=temporary();try {
  provisionAuthorization(root,SYNTHETIC_APPROVAL);
  const db=new DatabaseSync(join(root,'authorization.sqlite'));
  db.exec(`CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE deferred_child (id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER fail_commit AFTER INSERT ON sends BEGIN INSERT INTO deferred_child VALUES(999); END;`);db.close();
  let sends=0;const transport=authorizedTransport(root,SYNTHETIC_APPROVAL,async()=>{sends++;});
  await assert.rejects(()=>transport(url,options('job-analysis')));assert.equal(sends,0);assert.equal(authorizationState(root,SYNTHETIC_APPROVAL).consumed,0);
 }finally{rmSync(root,{recursive:true});}
});
test.skipIf(process.env.GATE_A_DOCKER_TESTS!=='1')('GA-04 actual read-only Docker mount rejects SQLite writes',()=>{
 mkdirSync(resolve('.verification/openrouter'),{recursive:true,mode:0o700});
 const root=mkdtempSync(resolve('.verification/openrouter/readonly-test-'));try {
  provisionAuthorization(root,SYNTHETIC_APPROVAL);
  const result=spawnSync('docker',['run','--rm','--network','none','--user',`${process.getuid()}:${process.getgid()}`,'--mount',`type=bind,src=${root},dst=/store,readonly`,'--mount',`type=bind,src=${resolve('scripts/openrouter-verification')},dst=/verification,readonly`,'smart-recruit-openrouter-verification','node','--input-type=module','-e',"import {authorizedTransport,SYNTHETIC_APPROVAL} from '/verification/authorization.mjs'; let calls=0; const send=authorizedTransport('/store',SYNTHETIC_APPROVAL,async()=>{calls++;}); try {await send('https://openrouter.ai/api/v1/chat/completions',{method:'POST',redirect:'error',body:JSON.stringify({messages:[{},{content:JSON.stringify({correlationId:'11111111-1111-4111-8111-111111111111'})}],response_format:{json_schema:{name:'job_analysis'}}})});process.exitCode=3;}catch{process.exitCode=calls===0?0:4;}"],{encoding:'utf8'});
  assert.equal(result.status,0,'read-only mount test failed');assert.equal(authorizationState(root,SYNTHETIC_APPROVAL).consumed,0);
 }finally{rmSync(root,{recursive:true});}
});
function fixtures() {
 const expected=['job-analysis','rubric-draft'].map((task,n)=>({task,operationId:randomUUID(),aiRequestId:randomUUID(),providerGenerationId:`gen-${n}`}));
 const app=expected.map(e=>({...e,attempt:1,provider:'Synthetic',model:'verification/synthetic',inputTokens:10,outputTokens:20,cacheReadTokens:0,cacheWriteTokens:0,applicationRecordedCost:'0.00100000',settled:true}));
 const provider=app.map(a=>({...a,providerReportedCost:'0.00100000'}));
 return {expected,app,provider};
}
const negatives={
 'both empty':()=>[[],[]],
 'empty application':f=>[[],f.provider],
 'empty provider':f=>[f.app,[]],
 'truncated application':f=>[f.app.slice(0,1),f.provider],
 'truncated provider':f=>[f.app,f.provider.slice(0,1)],
 'duplicate application':f=>[[f.app[0],f.app[0]],f.provider],
 'duplicate provider':f=>[f.app,[f.provider[0],f.provider[0]]],
 'missing generation':f=>[f.app.map(a=>({...a,providerGenerationId:null})),f.provider],
 'unknown cost':f=>[f.app.map(a=>({...a,applicationRecordedCost:null})),f.provider],
 'unknown tokens':f=>[f.app,f.provider.map(p=>({...p,inputTokens:null}))],
 'mismatched cost':f=>[f.app,f.provider.map(p=>({...p,providerReportedCost:'0.00200000'}))],
 'wrong task':f=>[f.app.map(a=>({...a,task:'job-analysis'})),f.provider],
 'unexpected application':f=>[[...f.app,{...f.app[0],operationId:randomUUID()}],f.provider],
 'unexpected provider':f=>[f.app,[...f.provider,{...f.provider[0],providerGenerationId:'extra'}]],
};
for(const [name,mutate] of Object.entries(negatives))test(`GA-03 rejects ${name}`,()=>{
 const f=fixtures(),[app,provider]=mutate(f);const report=reconcile(app,provider,'synthetic-independent-fixture',f.expected);
 assert.equal(report.status,'INCOMPLETE');assert.equal(report.provenanceVerified,false);
 if(name==='both empty'){assert.equal(report.applicationTotal.knownCost,null);assert.equal(report.providerTotal.knownCost,null);}
 if(name==='unexpected application')assert.equal(report.unexpectedApplication[0].classification,'UNEXPECTED_APPLICATION');
 if(name==='unexpected provider')assert.equal(report.unexpectedProvider[0].classification,'UNEXPECTED_PROVIDER');
});
test('GA-03 requires both planned operations and complete inventory; CLI rejects empty arrays',()=>{
 const f=fixtures();assert.equal(reconcile(f.app,f.provider,'synthetic-independent-fixture',f.expected).status,'PASS');
 assert.throws(()=>reconcile(f.app,f.provider,'synthetic-independent-fixture'));assert.throws(()=>reconcile(f.app,f.provider,'synthetic-independent-fixture',[]));
 const root=temporary();try {
  writeFileSync(join(root,'empty.json'),'[]');writeFileSync(join(root,'expected.json'),JSON.stringify(f.expected));
  const result=spawnSync(process.execPath,['scripts/openrouter-verification/reconcile.mjs',join(root,'empty.json'),join(root,'empty.json'),join(root,'expected.json'),'synthetic-independent-fixture'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stderr.trim(),'RECONCILIATION_INPUT_INVALID'); // unsigned inventory is no longer accepted
 }finally{rmSync(root,{recursive:true});}
});
test('GA-02 smoke and reserved live entry are disabled before gateway or credentials can be read',()=>{
 for(const script of ['scripts/openrouter-smoke.mjs','scripts/openrouter-verification/live-entry.mjs']) {
  const result=spawnSync(process.execPath,[script,'--approved-live'],{env:{...process.env,OPENROUTER_API_KEY:'SYNTHETIC_SENTINEL_NEVER_PRINT'},encoding:'utf8'});
  assert.equal(result.status,1);assert(!`${result.stdout}${result.stderr}`.includes('SYNTHETIC_SENTINEL_NEVER_PRINT'));
  const source=readFileSync(script,'utf8');assert(!source.includes('new AiGateway'));assert(!source.includes('fetch('));assert(!source.includes('process.env'));
 }
});

test('GA-01 live authorization cannot be provisioned in run-selected or synthetic roots',()=>{
 const root=temporary();try {
  for(const name of ['', 'renamed', 'another'])assert.throws(()=>provisionAuthorization(join(root,name),{...SYNTHETIC_APPROVAL,purpose:'live-approval'}),/ROOT_FIXED/);
 }finally{rmSync(root,{recursive:true});}
});
