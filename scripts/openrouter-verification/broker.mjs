import http from 'node:http';
import {readFileSync,chmodSync,unlinkSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AUTHORIZATION_ROOT,SOCKET_PATH,validateApproval,validateInference,validateProviderResponse,digest} from './broker-policy.mjs';
import {consume,counterState} from './limit.mjs';
const load=createRequire('/app/package.json'),contracts=load('@smart-recruit/ai-contracts');
const ledger=`${AUTHORIZATION_ROOT}/ledger.sqlite`;
const read=path=>JSON.parse(readFileSync(path,'utf8'));
let secret,initialDigest;
function approval() {
 const built=read('/broker-build.json');
 for(const [file,hash] of Object.entries(built.files))if(digest(readFileSync(`/verification/${file}`,'utf8'))!==hash)throw new Error('BROKER_SOURCE_CHANGED');
 const a=validateApproval(read('/approval/approval.json'),read('/trust/installation.json'),readFileSync('/trust/owner-public.pem'),built);
 const hash=digest(a);if(initialDigest&&hash!==initialDigest)throw new Error('APPROVAL_CHANGED');
 counterState(ledger,hash);return {a,hash};
}
// One native HTTP request, fixed destination, no redirects, no agent reuse/retries.
function providerPost(envelope) {
 return new Promise(resolve=>{
  let finished=false;
  const done=(status,payload)=>{if(!finished){finished=true;clearTimeout(timer);resolve({status,payload});}};
  const request=http.request({hostname:'provider',port:8081,path:'/api/v1/chat/completions',method:'POST',agent:false,headers:{'content-type':'application/json',authorization:`Bearer ${secret}`}},response=>{
   const chunks=[];let bytes=0;
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>150000){response.destroy();done(502,'{"error":"PROVIDER_RESPONSE_REJECTED"}');}else chunks.push(chunk);});
   response.on('error',()=>done(502,'{"error":"PROVIDER_OUTCOME_UNKNOWN"}'));
   response.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');const status=response.statusCode||502;
    if(status<200||status>=300||text.includes(secret))done(status>=200&&status<300?502:status,'{"error":"PROVIDER_RESPONSE_REJECTED"}');else {try{done(status,validateProviderResponse(text,secret,envelope,contracts));}catch{done(502,'{"error":"PROVIDER_RESPONSE_REJECTED"}');}}
   });
  });
  const timer=setTimeout(()=>{request.destroy();done(504,'{"error":"PROVIDER_OUTCOME_UNKNOWN"}');},1500);
  request.on('error',()=>done(502,'{"error":"PROVIDER_OUTCOME_UNKNOWN"}'));
  request.end(JSON.stringify(envelope.body));
 });
}
try {
 const initial=approval();initialDigest=initial.hash;
 secret=readFileSync('/run/secrets/provider-key','utf8').trim();
 if(!/^gate-a-sentinel-[a-f0-9]{48}$/.test(secret))throw new Error('SYNTHETIC_CREDENTIAL_REQUIRED');
 if(existsSync(SOCKET_PATH))unlinkSync(SOCKET_PATH);
 const server=http.createServer(async(req,res)=>{
  const reject=()=>{if(!res.headersSent){res.writeHead(403,{'content-type':'application/json'});res.end('{"error":"VERIFICATION_DENIED"}');}};
  if(req.method!=='POST'||req.url!=='/inference'){req.resume();reject();return;}
  let bytes=0;const chunks=[];
  try {
   for await(const chunk of req){bytes+=chunk.length;if(bytes>70000)throw new Error('IPC_TOO_LARGE');chunks.push(chunk);}
   const envelope=JSON.parse(Buffer.concat(chunks).toString('utf8')),{a,hash}=approval();
   const entry=validateInference(envelope,a,contracts);
   consume(ledger,entry.task,entry.operationId,hash); // DURABLE ADMISSION before any network operation.
   const result=await providerPost(envelope);
   res.writeHead(result.status,{'content-type':'application/json'});res.end(result.payload);
  } catch {reject();}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;
 server.listen(SOCKET_PATH,()=>chmodSync(SOCKET_PATH,0o660));
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
} catch {console.error('BROKER_START_DENIED');process.exitCode=1;}
