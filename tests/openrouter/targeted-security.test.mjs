import {test} from 'vitest';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {validateProviderResponse,canonical,PROVIDER_ENDPOINT} from '../../scripts/openrouter-verification/broker-policy.mjs';
import {approvedInventory,reconcile} from '../../scripts/openrouter-verification/evidence.mjs';
import {responseFixture,responseAttackModes,description} from '../../scripts/openrouter-verification/fixture.mjs';
const contracts=createRequire(import.meta.url)('../../packages/ai-contracts/dist');
const envelope=()=>({task:'job-analysis',body:{messages:[{}, {content:JSON.stringify({correlationId:randomUUID(),data:{description,requirements:[]}})}],response_format:{json_schema:{name:'job_analysis'}}}});
for(const mode of [...responseAttackModes,'valid'])test(`decoded provider response ${mode}`,()=>{
 const secret=`gate-a-sentinel-${randomBytes(24).toString('hex')}`,e=envelope(),text=responseFixture(mode,{body:JSON.stringify(e.body)},secret);
 if(mode==='valid'){const result=JSON.parse(validateProviderResponse(text,secret,e,contracts));assert.equal(result.usage.prompt_tokens,100);}
 else assert.throws(()=>validateProviderResponse(text,secret,e,contracts),{message:'PROVIDER_RESPONSE_REJECTED'});
});
test('unknown response usage remains absent',()=>{const e=envelope(),b=JSON.parse(responseFixture('valid',{body:JSON.stringify(e.body)},'sentinel'));delete b.usage;assert(!('usage' in JSON.parse(validateProviderResponse(JSON.stringify(b),'sentinel',e,contracts))));});
function fixture(){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const a={version:1,purpose:'gate-a-synthetic',authorizationId:randomUUID(),installationId:randomUUID(),sourceDigest:'a'.repeat(64),brokerImage:`sha256:${'b'.repeat(64)}`,applicationImage:`sha256:${'c'.repeat(64)}`,model:'verification/synthetic',provider:'Synthetic',endpoint:PROVIDER_ENDPOINT,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),maxOutputTokens:4096,maxRequestBytes:65536,tasks:['job-analysis','rubric-draft'].map(task=>({task,operationId:randomUUID(),workloadHash:'d'.repeat(64)}))};
 const trust=Object.fromEntries(['authorizationId','installationId','sourceDigest','brokerImage','applicationImage'].map(k=>[k,a[k]])),built={sourceDigest:a.sourceDigest,applicationImage:a.applicationImage};
 const requests=a.tasks.map(t=>({task:t.task,operationId:t.operationId,aiRequestId:randomUUID()})),receipts=a.tasks.map(t=>({task:t.task,operationId:t.operationId,providerGenerationId:`gen-${randomUUID()}`}));
 const provider=receipts.map(g=>({providerGenerationId:g.providerGenerationId,provider:'Synthetic',model:'verification/synthetic',inputTokens:100,outputTokens:50,cacheReadTokens:0,cacheWriteTokens:5,providerReportedCost:'0.001'}));
 const application=requests.map((r,i)=>({...r,...provider[i],attempt:1,settled:true,applicationRecordedCost:'0.001'}));
 return {signed:{approval:a,signature:sign(null,Buffer.from(canonical(a)),privateKey).toString('base64')},trust,built,publicKey,requests,receipts,provider,application};
}
const cases={
 'valid signed inventory':()=>{},
 'modified analysis operation':f=>f.application[0].operationId=randomUUID(),
 'modified rubric operation':f=>f.application[1].operationId=randomUUID(),
 'swapped operation IDs':f=>{[f.application[0].operationId,f.application[1].operationId]=[f.application[1].operationId,f.application[0].operationId];},
 'missing analysis':f=>f.application.shift(),'missing rubric':f=>f.application.pop(),
 'duplicate operation':f=>f.application[1].operationId=f.application[0].operationId,
 'unexpected third operation':f=>f.application.push({...f.application[0],operationId:randomUUID()}),
 'modified request ID':f=>f.application[0].aiRequestId=randomUUID(),
 'swapped request IDs':f=>{[f.application[0].aiRequestId,f.application[1].aiRequestId]=[f.application[1].aiRequestId,f.application[0].aiRequestId];},
 'missing generation':f=>delete f.application[0].providerGenerationId,
 'modified generation':f=>f.application[0].providerGenerationId='gen-other',
 'duplicate generation':f=>f.application[1].providerGenerationId=f.application[0].providerGenerationId,
 'empty application':f=>f.application=[], 'empty provider':f=>f.provider=[], 'both empty':f=>{f.application=[];f.provider=[];},
 'truncated evidence':f=>f.provider.pop(),
 'invalid signature':f=>f.signed.signature='invalid',
 'expired approval':f=>f.now=Date.now()+120000,
 'approval application mismatch':f=>f.application.forEach(r=>r.operationId=randomUUID()),
 'unknown cost':f=>delete f.provider[0].providerReportedCost,
 'unknown usage':f=>delete f.application[0].inputTokens,
 'request binding mismatch':f=>f.requests[0].operationId=randomUUID(),
 'generation receipt mismatch':f=>f.receipts[0].task='rubric-draft'
};
for(const [name,mutate] of Object.entries(cases))test(`signed reconciliation ${name}`,()=>{
 const f=fixture();mutate(f);let status='REJECTED';try{const expected=approvedInventory(f.signed,f.trust,f.publicKey,f.built,f.requests,f.receipts,f.now);status=reconcile(f.application,f.provider,'synthetic-independent-fixture',expected).status;}catch{/* invalid bindings must fail closed */}
 if(name==='valid signed inventory')assert.equal(status,'PASS');else assert.notEqual(status,'PASS');
});
