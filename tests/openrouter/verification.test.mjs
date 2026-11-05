import {test} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {initializeCounter,consume,boundedTransport,counterState} from '../../scripts/openrouter-verification/limit.mjs';
import {generationRecord,applicationRecord,reconcile} from '../../scripts/openrouter-verification/evidence.mjs';
import {designatedSettings} from '../../scripts/openrouter-verification/fixture.mjs';
function fixture(){const dir=mkdtempSync(join(tmpdir(),'or-synthetic-'));const path=join(dir,'counter.sqlite');initializeCounter(path);return {dir,path};}
function child(path,task){return new Promise(resolveExit=>{const proc=spawn(process.execPath,[resolve('tests/openrouter/counter-child.mjs'),path,task,randomUUID()],{stdio:'ignore'});proc.once('exit',resolveExit);});}
test('atomic two-send ceiling across concurrent processes, reopen and ordinary reinitialization',async()=>{
 const {dir,path}=fixture();try {
  const results=await Promise.all(Array.from({length:12},(_,i)=>child(path,i%2?'rubric-draft':'job-analysis')));
  assert.equal(results.filter(x=>x===0).length,2);assert.equal(results.filter(x=>x===2).length,10);
  assert.deepEqual(counterState(path),{consumed:2,limit:2});
  assert.equal(await child(path,'job-analysis'),2);assert.equal(await child(path,'rubric-draft'),2);
  assert.throws(()=>initializeCounter(path));assert.throws(()=>consume(path,'job-analysis',randomUUID()));
 }finally{rmSync(dir,{recursive:true});}
});
test('failed sends consume before transport, retries denied and missing/corrupt stores fail closed',async()=>{
 const {dir,path}=fixture();try {
  let sends=0;const transport=boundedTransport(path,async()=>{sends++;throw new Error('synthetic interruption');});
  const options={method:'POST',redirect:'error',body:JSON.stringify({messages:[{}, {content:JSON.stringify({correlationId:randomUUID()})}],response_format:{json_schema:{name:'job_analysis'}}})};
  await assert.rejects(()=>transport('https://openrouter.ai/api/v1/chat/completions',options));
  await assert.rejects(()=>transport('https://openrouter.ai/api/v1/chat/completions',options));assert.equal(sends,1);
  assert.throws(()=>consume(join(dir,'missing.sqlite'),'rubric-draft',randomUUID()));
  writeFileSync(join(dir,'corrupt.sqlite'),'corrupt');assert.throws(()=>consume(join(dir,'corrupt.sqlite'),'rubric-draft',randomUUID()));
  await assert.rejects(()=>transport('https://example.invalid',options));assert.equal(sends,1);
 }finally{rmSync(dir,{recursive:true});}
});
test('accounting preserves unknowns, reports discrepancies and allowlists evidence',()=>{
 const unknown=generationRecord({authorization:'SECRET',usage:{cost:null},error:{message:'RAW'}});
 assert.equal(unknown.providerReportedCost,null);assert.equal(unknown.inputTokens,null);assert.equal(unknown.cacheReadTokens,null);
 const provider=generationRecord({id:'gen-1',model:'test/model',provider:'Test',usage:{prompt_tokens:2,completion_tokens:3,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:0},cost:0.1}});
 const app=applicationRecord({operationId:randomUUID(),attempt:1,providerGenerationId:'gen-1',returnedModel:'test/model',provider:'Test',inputTokens:2,outputTokens:3,cacheReadTokens:0,cacheWriteTokens:0,cost:0.1,settledAt:new Date(),authorization:'SECRET'},{id:randomUUID()});
 const inventory=[{operationId:app.operationId,aiRequestId:app.aiRequestId,task:'job-analysis',providerGenerationId:'gen-1'},{operationId:randomUUID(),aiRequestId:randomUUID(),task:'rubric-draft',providerGenerationId:'gen-2'}];
 assert.equal(reconcile([app],[provider],'synthetic-independent-fixture',inventory).comparisons[0].reconciliation,'MATCH');
 assert.equal(reconcile([app],[{...provider,providerReportedCost:'0.20000000'}],'synthetic-independent-fixture',inventory).comparisons[0].reconciliation,'MISMATCH');
 assert.equal(reconcile([{...app,providerGenerationId:null}],[provider],'synthetic-independent-fixture',inventory).comparisons[0].reconciliation,'INCOMPLETE');
 assert.equal(reconcile([{...app,settled:false}],[provider],'synthetic-independent-fixture',inventory).comparisons[0].reconciliation,'INCOMPLETE');
 assert(reconcile([app,app],[provider],'synthetic-independent-fixture',inventory).comparisons.every(r=>r.reconciliation==='INCOMPLETE'));
 assert.equal(generationRecord({usage:{cost:''}}).providerReportedCost,null);
 assert.equal(generationRecord({usage:{cost:1e-8}}).providerReportedCost,'0.00000001');
 assert.equal(generationRecord({usage:{cost:'123456789.12345678'}}).providerReportedCost,'123456789.12345678');
 assert.equal(reconcile([app],[provider],'synthetic-independent-fixture',inventory).applicationTotal.knownCost,'0.10000000');
 assert(!JSON.stringify({unknown,app}).includes('SECRET'));assert(!JSON.stringify(unknown).includes('RAW'));
});
test('designated provider verification refuses mock and arbitrary credential configuration',()=>{
 const previous={...process.env};try {
  process.env.VERIFICATION_MODE='synthetic';process.env.AI_PROVIDER='mock';process.env.OPENROUTER_API_KEY='synthetic-not-a-credential';assert.throws(()=>designatedSettings(()=>({})),/MODE_DENIED/);
  process.env.AI_PROVIDER='openrouter';assert.deepEqual(designatedSettings(()=>({designated:true})),{designated:true});
  process.env.OPENROUTER_API_KEY='not-allowed';assert.throws(()=>designatedSettings(()=>({})),/MODE_DENIED/);
 }finally{for(const k of ['VERIFICATION_MODE','AI_PROVIDER','OPENROUTER_API_KEY']){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
});

test('counter update failure fails closed before transport',async()=>{
 const {dir,path}=fixture();try {
  const db=new DatabaseSync(path);db.exec("CREATE TRIGGER deny_send BEFORE INSERT ON sends BEGIN SELECT RAISE(ABORT, 'synthetic store failure'); END");db.close();
  let sends=0;const transport=boundedTransport(path,async()=>{sends++;return new Response('{}');});
  const options={method:'POST',redirect:'error',body:JSON.stringify({messages:[{}, {content:JSON.stringify({correlationId:randomUUID()})}],response_format:{json_schema:{name:'job_analysis'}}})};
  await assert.rejects(()=>transport('https://openrouter.ai/api/v1/chat/completions',options));assert.equal(sends,0);
 }finally{rmSync(dir,{recursive:true});}
});

test('a separately started process sees the first committed send and only the remaining slot',async()=>{
 const {dir,path}=fixture();try {
  assert.equal(await child(path,'job-analysis'),0);assert.equal(counterState(path).consumed,1);
  assert.equal(await child(path,'job-analysis'),2);assert.equal(await child(path,'rubric-draft'),0);
  assert.equal(counterState(path).consumed,2);assert.equal(await child(path,'rubric-draft'),2);
 }finally{rmSync(dir,{recursive:true});}
});
