import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contract, inputSchema, mockOutput, validateOutput, type DraftInput, type DraftingTask } from '@smart-recruit/ai-contracts';
export const hash = (value:string) => createHash('sha256').update(value).digest('hex');
export function hashJson(value:unknown):string {
 const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
 return hash(JSON.stringify(canonical(value)));
}
const routeSchema=z.strictObject({model:z.string().min(3),provider:z.string().min(1),contextTokens:z.number().int().min(8192),maxOutputTokens:z.number().int().min(1024),inputCostPerMillion:z.number().nonnegative(),outputCostPerMillion:z.number().nonnegative(),structuredOutputs:z.literal(true),zdr:z.literal(true),verifiedAt:z.string().datetime()});
const settingsSchema=z.object({AI_PROVIDER:z.enum(['mock','openrouter']),OPENROUTER_API_KEY:z.string().optional(),OPENROUTER_BASE_URL:z.literal('https://openrouter.ai/api/v1').default('https://openrouter.ai/api/v1'),AI_MODEL_JOB_ANALYSIS:z.string().optional(),AI_MODEL_RUBRIC_DRAFT:z.string().optional(),AI_ROUTE_MANIFEST:z.string().optional(),AI_TIMEOUT_MS:z.coerce.number().int().min(100).max(90000).default(90000),AI_COMPANY_CONCURRENCY:z.coerce.number().int().min(1).max(4).default(2),AI_DAILY_TOKEN_BUDGET:z.coerce.number().int().min(32768).default(1000000),AI_DAILY_COST_BUDGET_USD:z.coerce.number().positive().max(1000).default(10),AI_DAILY_CALL_LIMIT:z.coerce.number().int().min(1).max(1000).default(100)});
export function aiSettings(env:NodeJS.ProcessEnv=process.env) {
 const parsed=settingsSchema.safeParse(env);
 if(!parsed.success)throw new Error('AI_CONFIGURATION_INVALID');
 const value=parsed.data;
 let routes:Record<DraftingTask,z.infer<typeof routeSchema>>|undefined;
 if(value.AI_PROVIDER==='openrouter') {
  try {
   routes=z.strictObject({'job-analysis':routeSchema,'rubric-draft':routeSchema}).parse(JSON.parse(value.AI_ROUTE_MANIFEST||''));
   if(!value.OPENROUTER_API_KEY||routes['job-analysis'].model!==value.AI_MODEL_JOB_ANALYSIS||routes['rubric-draft'].model!==value.AI_MODEL_RUBRIC_DRAFT||Object.values(routes).some(r=>Date.now()-Date.parse(r.verifiedAt)>7*86400000||Date.parse(r.verifiedAt)>Date.now()))throw new Error();
  } catch {throw new Error('AI_ROUTE_VERIFICATION_REQUIRED');}
 }
 return {...value,routes,policyVersion:hash(JSON.stringify(routes||'mock-policy-v1'))};
}
export type AiSettings=ReturnType<typeof aiSettings>;
export interface ProviderUsage {
 model?:string; provider?:string; inputTokens?:number; outputTokens?:number; cost?:number;
 cacheReadTokens?:number; cacheWriteTokens?:number; providerGenerationId?:string;
 usageMetadataStatus:'UNKNOWN'|'VALID'|'INVALID';
}
export class AiFailure extends Error {
 constructor(readonly code:string,readonly retryable=false,readonly retryAfterMs=0,readonly usage?:ProviderUsage){super(code);}
}
const counter=z.number().int().min(0).max(2147483647);
const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
// Optional metadata is independently validated: malformed counters never become zero,
// and cannot hide valid generation identity or other returned usage fields.
export function providerUsage(raw:unknown):ProviderUsage {
 const body=record(raw),usage=record(body.usage),details=record(usage.prompt_tokens_details);
 let invalid=false,known=false;
 const read=<T>(schema:z.ZodType<T>,value:unknown):T|undefined=>{if(value===undefined||value===null)return undefined;const p=schema.safeParse(value);if(!p.success){invalid=true;return undefined;}known=true;return p.data;};
 if(body.usage!=null&&(typeof body.usage!=='object'||Array.isArray(body.usage)))invalid=true;
 if(usage.prompt_tokens_details!=null&&(typeof usage.prompt_tokens_details!=='object'||Array.isArray(usage.prompt_tokens_details)))invalid=true;
 const result={model:read(z.string().min(1).max(200),body.model),provider:read(z.string().min(1).max(200),body.provider),
 providerGenerationId:read(z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/),body.id),
 inputTokens:read(counter,usage.prompt_tokens),outputTokens:read(counter,usage.completion_tokens),
 cacheReadTokens:read(counter,details.cached_tokens),cacheWriteTokens:read(counter,details.cache_write_tokens),cost:read(z.number().min(0).max(9999999999),usage.cost)};
 return {...result,usageMetadataStatus:invalid?'INVALID':known?'VALID':'UNKNOWN'};
}
const responseSchema=z.object({model:z.string(),provider:z.string(),choices:z.array(z.object({message:z.object({content:z.string().max(100000)}),finish_reason:z.literal('stop')})).length(1)});
async function boundedJson(response:Response) {
 const reader=response.body?.getReader();if(!reader)throw new AiFailure('INVALID_OUTPUT',true);
 const chunks:Uint8Array[]=[];let size=0;
 try {while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>150000)throw new AiFailure('INVALID_OUTPUT',true);chunks.push(item.value);}}
 finally {await reader.cancel();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw new AiFailure('INVALID_OUTPUT',true);}
}
export class AiGateway {
 constructor(readonly settings:AiSettings=aiSettings(),private readonly transport:typeof fetch=fetch){}
 pin(task:DraftingTask){return {mode:this.settings.AI_PROVIDER,model:this.settings.routes?.[task].model||'deterministic-mock-v1',...contract(task),policyVersion:this.settings.policyVersion};}
 reservation(task:DraftingTask,input:DraftInput) {
  const route=this.settings.routes?.[task];
  const outputTokens=Math.min(4096,route?.maxOutputTokens||4096);
  const inputTokens=Buffer.byteLength(JSON.stringify(input))+Buffer.byteLength(JSON.stringify(contract(task).jsonSchema))+Buffer.byteLength(contract(task).system)+1024;
  return {tokens:inputTokens+outputTokens,cost:route?Math.ceil((inputTokens*route.inputCostPerMillion+outputTokens*route.outputCostPerMillion)*100)/100000000:0};
 }
 async execute(task:DraftingTask,input:DraftInput,correlationId:string,model:string,feedback=false,deadlineAt?:Date) {
  input=inputSchema.parse(input);const pin=this.pin(task);
  if(model!==pin.model)throw new AiFailure('MODEL_CONFIGURATION_CHANGED');
  if(this.settings.AI_PROVIDER==='mock')return {output:validateOutput(task,mockOutput(task,input,correlationId),input,correlationId),model,provider:'mock',inputTokens:0,outputTokens:0,cost:0,usageMetadataStatus:'VALID' as const};
  const route=this.settings.routes![task];const maxTokens=Math.min(4096,route.maxOutputTokens);
  const messages=[{role:'system',content:pin.system+(feedback?' Your previous result failed validation. Follow the schema and exact evidence rules.':'')},{role:'user',content:JSON.stringify({correlationId,data:input})}];
  // UTF-8 bytes are a conservative upper bound for input tokens; never truncate evidence.
  if(this.reservation(task,input).tokens>route.contextTokens)throw new AiFailure('INPUT_BUDGET_EXCEEDED');
  let response:Response;
  try {
   response=await this.transport(`${this.settings.OPENROUTER_BASE_URL}/chat/completions`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(this.settings.AI_TIMEOUT_MS,deadlineAt?deadlineAt.getTime()-Date.now():this.settings.AI_TIMEOUT_MS))),headers:{authorization:`Bearer ${this.settings.OPENROUTER_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model,messages,max_tokens:maxTokens,stream:false,provider:{only:[route.provider],order:[route.provider],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true},response_format:{type:'json_schema',json_schema:{name:task.replaceAll('-','_'),strict:true,schema:pin.jsonSchema}}})});
   if(!response.ok){let usage:ProviderUsage|undefined;try{usage=providerUsage(await boundedJson(response));}catch{/* Preserve HTTP classification without retaining an invalid error body. */}const retry=response.headers.get('retry-after');const ms=retry?(Number.isFinite(Number(retry))?Number(retry)*1000:Date.parse(retry)-Date.now()):0;throw new AiFailure(response.status===429?'PROVIDER_RATE_LIMIT':response.status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_REJECTED',response.status===429||response.status>=500,Math.max(0,Math.min(ms||0,600000)),usage);}
   const raw=await boundedJson(response),usage=providerUsage(raw);
   const body=responseSchema.safeParse(raw);
   if(!body.success)throw new AiFailure('INVALID_OUTPUT',true,0,usage);
   if(body.data.model!==model||body.data.provider!==route.provider)throw new AiFailure('PROVIDER_ROUTE_MISMATCH',false,0,usage);
   let output;try{output=validateOutput(task,JSON.parse(body.data.choices[0]!.message.content),input,correlationId);}catch{throw new AiFailure('INVALID_OUTPUT',true,0,usage);}
   return {...usage,output,model:body.data.model,provider:body.data.provider};
  }catch(error){if(error instanceof AiFailure)throw error;throw new AiFailure('PROVIDER_TIMEOUT_OR_NETWORK',true);}
 }
}
