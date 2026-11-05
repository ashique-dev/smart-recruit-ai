import {test} from 'vitest';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {canonical,digest,validateApproval,validateInference,PROVIDER_ENDPOINT,AUTHORIZATION_ROOT} from '../../scripts/openrouter-verification/broker-policy.mjs';
const load=createRequire(import.meta.url),contracts=load('../../packages/ai-contracts/dist');
function fixture(){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),data={description:'Build APIs.',requirements:[]};
 const a={version:1,purpose:'gate-a-synthetic',authorizationId:randomUUID(),installationId:randomUUID(),sourceDigest:'a'.repeat(64),brokerImage:`sha256:${'b'.repeat(64)}`,applicationImage:`sha256:${'c'.repeat(64)}`,model:'verification/synthetic',provider:'Synthetic',endpoint:PROVIDER_ENDPOINT,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),maxOutputTokens:4096,maxRequestBytes:65536,tasks:['job-analysis','rubric-draft'].map(task=>({task,operationId:randomUUID(),workloadHash:digest(data)}))};
 const trust=Object.fromEntries(['authorizationId','installationId','sourceDigest','brokerImage','applicationImage'].map(k=>[k,a[k]]));
 const signed=approval=>({approval,signature:sign(null,Buffer.from(canonical(approval)),privateKey).toString('base64')});
 const built={sourceDigest:a.sourceDigest,applicationImage:a.applicationImage};
 const task=a.tasks[0],c=contracts.contract(task.task);
 const envelope={operationId:task.operationId,task:task.task,body:{model:a.model,messages:[{role:'system',content:c.system},{role:'user',content:JSON.stringify({correlationId:task.operationId,data})}],max_tokens:4096,stream:false,provider:{only:['Synthetic'],order:['Synthetic'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true},response_format:{type:'json_schema',json_schema:{name:'job_analysis',strict:true,schema:c.jsonSchema}}}};
 return {a,trust,built,signed,publicKey,envelope};
}
test('broker fixed paths and signed synthetic approval allow the exact compiled contract',()=>{
 const f=fixture();assert.equal(AUTHORIZATION_ROOT,'/authorization');assert.equal(validateApproval(f.signed(f.a),f.trust,f.publicKey,f.built),f.a);assert.equal(validateInference(f.envelope,f.a,contracts).operationId,f.a.tasks[0].operationId);
});
for(const [key,value] of [['purpose','live'],['endpoint','https://openrouter.ai/api/v1/chat/completions'],['model','changed/model'],['provider','Changed'],['installationId',randomUUID()],['authorizationId',randomUUID()],['sourceDigest','d'.repeat(64)],['brokerImage',`sha256:${'e'.repeat(64)}`],['applicationImage',`sha256:${'f'.repeat(64)}`],['maxOutputTokens',4097],['maxRequestBytes',100000]])test(`broker denies signed changed ${key}`,()=>{
 const f=fixture();assert.throws(()=>validateApproval(f.signed({...f.a,[key]:value}),f.trust,f.publicKey,f.built));
});
test('broker denies missing, forged, modified, expired and future-dated approvals',()=>{
 const f=fixture();assert.throws(()=>validateApproval(null,f.trust,f.publicKey,f.built));
 const changed=f.signed(f.a);changed.approval={...f.a,model:'changed'};assert.throws(()=>validateApproval(changed,f.trust,f.publicKey,f.built));
 assert.throws(()=>validateApproval(f.signed(f.a),f.trust,generateKeyPairSync('ed25519').publicKey,f.built));
 assert.throws(()=>validateApproval(f.signed({...f.a,expiresAt:new Date(Date.now()-1).toISOString()}),f.trust,f.publicKey,f.built));
 assert.throws(()=>validateApproval(f.signed({...f.a,issuedAt:new Date(Date.now()+30000).toISOString()}),f.trust,f.publicKey,f.built));
});
const mutations={
 'operation':e=>{e.operationId=randomUUID();},'task':e=>{e.task='catalog';},'url':e=>{e.url='https://example.invalid';},'proxy':e=>{e.method='GET';},'run name':e=>{e.runName='new';},
 'model':e=>{e.body.model='changed';},'provider':e=>{e.body.provider.only=['Changed'];},'fallback':e=>{e.body.provider.allow_fallbacks=true;},'token limit':e=>{e.body.max_tokens=4097;},'fractional tokens':e=>{e.body.max_tokens=1.5;},'stream':e=>{e.body.stream=true;},'schema':e=>{e.body.response_format.json_schema.schema={};},'system':e=>{e.body.messages[0].content='changed';},'workload':e=>{const user=JSON.parse(e.body.messages[1].content);user.data.description='Changed';e.body.messages[1].content=JSON.stringify(user);},'tool':e=>{e.body.tools=[];}
};
for(const [name,mutate] of Object.entries(mutations))test(`broker rejects unapproved request ${name}`,()=>{const f=fixture();mutate(f.envelope);assert.throws(()=>validateInference(f.envelope,f.a,contracts));});
