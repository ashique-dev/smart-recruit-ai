import {validateApproval} from './broker-policy.mjs';
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,256}$/.test(value) ? value : null;
const label = value => typeof value === 'string' && /^[A-Za-z0-9_.:/ -]{1,256}$/.test(value) ? value : null;
const cost = value => {
  if(value===undefined||value===null)return null;
  let text=String(value);
  if(typeof value==='number'||/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?e-[0-9]+$/.test(text)) {
    const numeric=Number(value);
    if(!Number.isFinite(numeric)||numeric<0||numeric>9999999999)return null;
    text=numeric.toFixed(8);
  }
  const match=/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(text);
  if(!match||Number(text)>9999999999)return null;
  const fraction=match[2]||'';
  const units=BigInt(match[1])*100000000n+BigInt(fraction.padEnd(8,'0').slice(0,8))+(Number(fraction[8]||0)>=5?1n:0n);
  return `${units/100000000n}.${String(units%100000000n).padStart(8,'0')}`;
};
// Deliberately excludes prompts, headers, credentials, cookies and raw error messages.
export function generationRecord(raw) {
  return {providerGenerationId:identity(raw?.id), provider:label(raw?.provider), model:identity(raw?.model),
    inputTokens:integer(raw?.usage?.prompt_tokens), outputTokens:integer(raw?.usage?.completion_tokens),
    cacheReadTokens:integer(raw?.usage?.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens:integer(raw?.usage?.prompt_tokens_details?.cache_write_tokens), providerReportedCost:cost(raw?.usage?.cost)};
}
export function applicationRecord(row, request) {
  return {operationId:identity(row.operationId), aiRequestId:identity(request.id), attempt:integer(row.attempt), task:identity(request.task),
    providerGenerationId:identity(row.providerGenerationId), provider:label(row.provider), model:identity(row.returnedModel),
    inputTokens:integer(row.inputTokens), outputTokens:integer(row.outputTokens), cacheReadTokens:integer(row.cacheReadTokens),
    cacheWriteTokens:integer(row.cacheWriteTokens), applicationRecordedCost:cost(row.cost),
    settled:row.settledAt !== null && row.settledAt !== undefined, costStatus:identity(row.costStatus), usageMetadataStatus:identity(row.usageMetadataStatus), outcome:identity(row.outcome)};
}
export function reconcile(application, independent, provenance, expected) {
  if (!['synthetic-independent-fixture','independent-provider-generation'].includes(provenance)) throw new Error('RECONCILIATION_PROVENANCE_REQUIRED');
  if(!Array.isArray(expected)||expected.length!==2||!Array.isArray(application)||!Array.isArray(independent))throw new Error('EXPECTED_INVENTORY_REQUIRED');
  const tasks=['job-analysis','rubric-draft'];
  expected=expected.map(e=>({operationId:identity(e.operationId),aiRequestId:identity(e.aiRequestId),task:identity(e.task),providerGenerationId:identity(e.providerGenerationId)}));
  if(tasks.some(task=>expected.filter(e=>e.task===task).length!==1)||expected.some(e=>!e.operationId||!e.aiRequestId)||
    new Set(expected.map(e=>e.operationId)).size!==2||new Set(expected.map(e=>e.aiRequestId)).size!==2)throw new Error('EXPECTED_INVENTORY_INVALID');
  // Re-project imported files too; never spread caller-controlled evidence properties.
  application = application.map(a => ({operationId:identity(a.operationId),aiRequestId:identity(a.aiRequestId),attempt:integer(a.attempt),task:identity(a.task),
    providerGenerationId:identity(a.providerGenerationId),provider:label(a.provider),model:identity(a.model),
    inputTokens:integer(a.inputTokens),outputTokens:integer(a.outputTokens),cacheReadTokens:integer(a.cacheReadTokens),cacheWriteTokens:integer(a.cacheWriteTokens),
    applicationRecordedCost:cost(a.applicationRecordedCost),settled:a.settled===true,costStatus:identity(a.costStatus),usageMetadataStatus:identity(a.usageMetadataStatus),outcome:identity(a.outcome)}));
  independent = independent.map(g => ({providerGenerationId:identity(g.providerGenerationId),provider:label(g.provider),model:identity(g.model),
    inputTokens:integer(g.inputTokens),outputTokens:integer(g.outputTokens),cacheReadTokens:integer(g.cacheReadTokens),cacheWriteTokens:integer(g.cacheWriteTokens),providerReportedCost:cost(g.providerReportedCost)}));
  const comparisons = application.map(app => {
    const matches = independent.filter(g => app.providerGenerationId && g.providerGenerationId === app.providerGenerationId);
    const provider = matches.length === 1 ? matches[0] : null;
    const fields = ['provider','model','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'];
    const differences = provider ? fields.filter(k => app[k] !== null && provider[k] !== null && app[k] !== provider[k]) : [];
    if (provider && app.applicationRecordedCost !== null && provider.providerReportedCost !== null && app.applicationRecordedCost !== provider.providerReportedCost) differences.push('cost');
    const unknown = !app.aiRequestId || !app.operationId || app.attempt!==1 || !app.settled || application.filter(a=>a.providerGenerationId && a.providerGenerationId===app.providerGenerationId).length!==1 || !provider || fields.some(k => app[k] === null || provider[k] === null) || app.applicationRecordedCost === null || provider.providerReportedCost === null;
    return {...app, providerReportedCost:provider?.providerReportedCost ?? null,
      reconciliation:differences.length ? 'MISMATCH' : unknown ? 'INCOMPLETE' : 'MATCH', differences};
  });
  const inventory=expected.map(e=>{
    const rows=application.filter(a=>a.operationId===e.operationId);
    const generations=independent.filter(g=>e.providerGenerationId&&g.providerGenerationId===e.providerGenerationId);
    const problems=[];
    if(rows.length!==1)problems.push(rows.length?'DUPLICATE_APPLICATION':'MISSING_APPLICATION');
    if(!e.providerGenerationId)problems.push('UNKNOWN_EXPECTED_GENERATION');
    if(generations.length!==1)problems.push(generations.length?'DUPLICATE_PROVIDER':'MISSING_PROVIDER');
    if(rows.length===1) {
      const row=rows[0];
      if(row.aiRequestId!==e.aiRequestId||row.task!==e.task||row.providerGenerationId!==e.providerGenerationId)problems.push('INVENTORY_MISMATCH');
      if(application.filter(a=>a.aiRequestId===row.aiRequestId).length!==1)problems.push('DUPLICATE_REQUEST');
      if(comparisons.find(c=>c.operationId===e.operationId)?.reconciliation!=='MATCH')problems.push('ACCOUNTING_INCOMPLETE_OR_MISMATCH');
    }
    return {...e,status:problems.length?'INCOMPLETE':'MATCH',problems};
  });
  const unexpectedApplication=application.filter(a=>!expected.some(e=>e.operationId===a.operationId)).map(a=>({operationId:a.operationId,classification:'UNEXPECTED_APPLICATION'}));
  const unexpectedProvider=independent.filter(g=>!expected.some(e=>e.providerGenerationId&&e.providerGenerationId===g.providerGenerationId)).map(g=>({providerGenerationId:g.providerGenerationId,classification:'UNEXPECTED_PROVIDER'}));
  const status=inventory.every(e=>e.status==='MATCH')&&!unexpectedApplication.length&&!unexpectedProvider.length&&application.length===2&&independent.length===2?'PASS':'INCOMPLETE';
  const total = (rows,key) => {
    const known=rows.filter(r=>r[key]!==null);
    const units=known.reduce((sum,r)=>sum+BigInt(r[key].replace('.','')),0n);
    return {knownCost:known.length?`${units/100000000n}.${String(units%100000000n).padStart(8,'0')}`:null,unknownCosts:rows.length-known.length,missingExpectedRows:Math.max(0,2-rows.length)};
  };
  return {status,provenance,provenanceVerified:false,inventory,unexpectedApplication,unexpectedProvider,comparisons, applicationTotal:total(application,'applicationRecordedCost'),providerTotal:total(independent,'providerReportedCost'), unmatchedProviderRecords:independent.filter(g => !application.some(a => a.providerGenerationId && a.providerGenerationId === g.providerGenerationId)).length};
}

// Expected operations originate ONLY from verified owner approval. Bind request IDs
// using a separate AiRequest export and generation IDs using provider-side receipts.
export function approvedInventory(signed,trust,publicKey,built,requests,receipts,now=Date.now()) {
 const approval=validateApproval(signed,trust,publicKey,built,now);
 if(!Array.isArray(requests)||!Array.isArray(receipts)||requests.length!==2||receipts.length!==2)throw new Error('BINDINGS_INCOMPLETE');
 const result=approval.tasks.map(t=>{
  const r=requests.filter(r=>r.operationId===t.operationId&&r.task===t.task);
  const g=receipts.filter(g=>g.operationId===t.operationId&&g.task===t.task);
  if(r.length!==1||g.length!==1||!identity(r[0].aiRequestId)||!identity(g[0].providerGenerationId))throw new Error('APPROVED_BINDING_MISMATCH');
  return {task:t.task,operationId:t.operationId,aiRequestId:r[0].aiRequestId,providerGenerationId:g[0].providerGenerationId};
 });
 if(new Set(result.map(r=>r.aiRequestId)).size!==2||new Set(result.map(r=>r.providerGenerationId)).size!==2)throw new Error('DUPLICATE_BINDING');
 return result;
}
