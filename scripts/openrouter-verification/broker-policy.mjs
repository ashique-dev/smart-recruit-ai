import {createHash,verify} from 'node:crypto';
export const AUTHORIZATION_ROOT='/authorization';
export const PROVIDER_ENDPOINT='http://provider:8081/api/v1/chat/completions';
export const SOCKET_PATH='/ipc/broker.sock';
export const canonical=value=>JSON.stringify(sort(value));
function sort(v){return Array.isArray(v)?v.map(sort):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validateApproval(signed,trust,publicKey,built,now=Date.now()) {
 if(!exact(signed,['approval','signature'])||typeof signed.signature!=='string'||!verify(null,Buffer.from(canonical(signed.approval)),publicKey,Buffer.from(signed.signature,'base64')))throw new Error('APPROVAL_INVALID');
 const a=signed.approval;
 if(!exact(a,['version','purpose','authorizationId','installationId','sourceDigest','brokerImage','applicationImage','model','provider','endpoint','issuedAt','expiresAt','maxOutputTokens','maxRequestBytes','tasks']))throw new Error('APPROVAL_SCHEMA');
 // Deliberately no live purpose or destination can be activated in this Gate A build.
 if(a.version!==1||a.purpose!=='gate-a-synthetic'||a.endpoint!==PROVIDER_ENDPOINT||a.model!=='verification/synthetic'||a.provider!=='Synthetic'||a.maxOutputTokens!==4096||a.maxRequestBytes!==65536)throw new Error('APPROVAL_SCOPE');
 if(!uuid(a.authorizationId)||!uuid(a.installationId)||!sha(a.sourceDigest)||!/^sha256:[a-f0-9]{64}$/.test(a.brokerImage)||!/^sha256:[a-f0-9]{64}$/.test(a.applicationImage))throw new Error('APPROVAL_IDENTITY');
 for(const key of ['authorizationId','installationId','sourceDigest','brokerImage','applicationImage'])if(a[key]!==trust[key])throw new Error('APPROVAL_INSTALLATION');
 if(a.sourceDigest!==built.sourceDigest||a.applicationImage!==built.applicationImage)throw new Error('APPROVAL_BUILD');
 const start=Date.parse(a.issuedAt),end=Date.parse(a.expiresAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end<=start||end-start>3600000)throw new Error('APPROVAL_EXPIRED');
 if(!Array.isArray(a.tasks)||a.tasks.length!==2||new Set(a.tasks.map(t=>t.operationId)).size!==2)throw new Error('APPROVAL_TASKS');
 for(const task of ['job-analysis','rubric-draft'])if(a.tasks.filter(t=>exact(t,['task','operationId','workloadHash'])&&t.task===task&&uuid(t.operationId)&&sha(t.workloadHash)).length!==1)throw new Error('APPROVAL_TASKS');
 return a;
}
export function validateInference(envelope,approval,contracts) {
 if(!exact(envelope,['operationId','task','body']))throw new Error('IPC_SCHEMA');
 const entry=approval.tasks.find(t=>t.task===envelope.task&&t.operationId===envelope.operationId);
 if(!entry)throw new Error('OPERATION_NOT_APPROVED');
 const body=envelope.body;
 if(!exact(body,['model','messages','max_tokens','stream','provider','response_format'])||!Array.isArray(body.messages)||body.messages.length!==2)throw new Error('REQUEST_SCHEMA');
 if(Buffer.byteLength(JSON.stringify(body))>approval.maxRequestBytes||!Number.isInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>approval.maxOutputTokens)throw new Error('TOKEN_LIMIT');
 const contract=contracts.contract(entry.task);
 let user;try{user=JSON.parse(body.messages[1].content);}catch{throw new Error('INPUT_SCHEMA');}
 if(!exact(user,['correlationId','data'])||user.correlationId!==entry.operationId)throw new Error('CORRELATION');
 const data=contracts.inputSchema.parse(user.data);
 if(digest(data)!==entry.workloadHash)throw new Error('WORKLOAD_CHANGED');
 const expected={model:approval.model,messages:[{role:'system',content:contract.system},{role:'user',content:canonical({correlationId:entry.operationId,data})}],max_tokens:body.max_tokens,stream:false,provider:{only:[approval.provider],order:[approval.provider],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true},response_format:{type:'json_schema',json_schema:{name:entry.task.replaceAll('-','_'),strict:true,schema:contract.jsonSchema}}};
 const normalized={...body,messages:[body.messages[0],{...body.messages[1],content:canonical(user)}]};
 if(canonical(expected)!==canonical(normalized))throw new Error('ROUTE_OR_CONTRACT_CHANGED');
 return entry;
}

// Validate decoded content before releasing any provider bytes across IPC.
export function validateProviderResponse(text,secret,envelope,contracts) {
 try {
  if(Buffer.byteLength(text)>150000)throw new Error();
  const scan=value=>{
   if(typeof value==='string'&&value.includes(secret))throw new Error();
   if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){scan(key);scan(v);}
  };
  const allowed=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
  const body=JSON.parse(text);scan(body);
  if(!allowed(body,['id','provider','model','usage','choices'])||!Array.isArray(body.choices)||body.choices.length!==1)throw new Error();
  for(const key of ['id','provider','model'])if(body[key]!=null&&typeof body[key]!=='string')throw new Error();
  const choice=body.choices[0];
  if(!exact(choice,['message','finish_reason'])||choice.finish_reason!=='stop'||!exact(choice.message,['content'])||typeof choice.message.content!=='string')throw new Error();
  const nested=JSON.parse(choice.message.content);scan(nested);
  const {data,correlationId}=JSON.parse(envelope.body.messages[1].content);
  contracts.validateOutput(envelope.task,nested,data,correlationId);
  if(body.usage!=null){
   if(!allowed(body.usage,['prompt_tokens','completion_tokens','prompt_tokens_details','cost']))throw new Error();
   const u=body.usage;
   for(const k of ['prompt_tokens','completion_tokens'])if(u[k]!=null&&(!Number.isSafeInteger(u[k])||u[k]<0))throw new Error();
   if(u.cost!=null&&(typeof u.cost!=='number'||!Number.isFinite(u.cost)||u.cost<0))throw new Error();
   if(u.prompt_tokens_details!=null){
    if(!allowed(u.prompt_tokens_details,['cached_tokens','cache_write_tokens']))throw new Error();
    for(const v of Object.values(u.prompt_tokens_details))if(v!=null&&(!Number.isSafeInteger(v)||v<0))throw new Error();
   }
  }
  // Re-serialize validated decoded objects; missing metadata remains missing.
  body.choices[0].message.content=JSON.stringify(nested);return JSON.stringify(body);
 }catch{throw new Error('PROVIDER_RESPONSE_REJECTED');}
}
