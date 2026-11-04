import {writeFileSync} from 'node:fs';
// Deliberately opt-in. This script is never called by startup, CI, or health probes.
if(!process.argv.includes('--approved-catalog'))throw new Error('Explicit owner approval is required before catalog API calls.');
const base='https://openrouter.ai/api/v1';
if(process.env.OPENROUTER_BASE_URL&&process.env.OPENROUTER_BASE_URL!==base)throw new Error('Unsupported provider base URL');
if(!process.env.OPENROUTER_API_KEY)throw new Error('OPENROUTER_API_KEY required in protected server environment');
async function get(path){const response=await fetch(base+path,{headers:{authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok){await response.body?.cancel();throw new Error(`Catalog returned HTTP ${response.status}`);}return response.json();}
const routes={};
for(const [task,key,providerKey] of [['job-analysis','AI_MODEL_JOB_ANALYSIS','AI_PROVIDER_JOB_ANALYSIS'],['rubric-draft','AI_MODEL_RUBRIC_DRAFT','AI_PROVIDER_RUBRIC_DRAFT']]){
 const model=process.env[key],provider=process.env[providerKey];if(!model||!provider||!/^[A-Za-z0-9_.:/ -]{1,120}$/.test(provider)||!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+$/.test(model))throw new Error(`Configure ${key} and ${providerKey} first`);
 const catalog=await get('/models');const entry=catalog.data?.find(m=>m.id===model);if(!entry)throw new Error(`Configured ${task} model not found`);
 const endpoints=await get(`/models/${model.split('/').map(encodeURIComponent).join('/')}/endpoints`);
 const zdr=await get('/endpoints/zdr');
 const route=endpoints.data?.endpoints?.find(e=>e.provider_name===provider&&e.status===0&&e.supported_parameters?.includes('structured_outputs')&&e.supported_parameters?.includes('response_format'));
 // Require exact endpoint identity in the ZDR catalog; ambiguous metadata fails closed.
 const privateEndpoint=route&&zdr.data?.find(e=>e.name===route.name&&e.provider_name===provider&&e.model_id===model);
 if(!route||!privateEndpoint)throw new Error(`Unable to verify strict-output/ZDR endpoint for ${task}; inspect catalog privately. No route enabled.`);
 const prices=[route.pricing?.prompt,route.pricing?.completion];
 if(prices.some(v=>(typeof v!=='string'&&typeof v!=='number')||String(v).trim()===''))throw new Error('Missing prices; unknown cost must not become zero');
 const input=Number(prices[0]),output=Number(prices[1]);
 if(!Number.isFinite(input)||input<0||!Number.isFinite(output)||output<0||!Number.isInteger(route.context_length)||!Number.isInteger(route.max_completion_tokens))throw new Error('Incomplete token limits/pricing; manual review required');
 routes[task]={model,provider,contextTokens:route.context_length,maxOutputTokens:route.max_completion_tokens,inputCostPerMillion:input*1000000,outputCostPerMillion:output*1000000,structuredOutputs:true,zdr:true,verifiedAt:new Date().toISOString()};
}
// No credentials or prompt content in output. This is evidence for review, not approval to infer.
writeFileSync('.env.openrouter.routes',`AI_ROUTE_MANIFEST='${JSON.stringify(routes)}'\n`,{mode:0o600});
console.log('Verified catalog routes written to ignored .env.openrouter.routes. Review provider policy before separately approving inference.');
