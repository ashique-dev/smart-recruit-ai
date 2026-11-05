import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,unlinkSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {canonical,digest,PROVIDER_ENDPOINT} from './broker-policy.mjs';
import {initializeCounter,counterState} from './limit.mjs';
import {description,requirement,responseAttackModes} from './fixture.mjs';
import {reconcile,approvedInventory} from './evidence.mjs';
const load=createRequire(resolve('apps/api/package.json')),contracts=load('@smart-recruit/ai-contracts');
const build=JSON.parse(readFileSync('.verification/openrouter/broker-build/provenance.json','utf8'));
for(const [file,hash] of Object.entries(build.files))assert.equal(digest(readFileSync(`scripts/openrouter-verification/${file}`,'utf8')),hash,'Broker sources changed since build');
const runId=randomUUID(),root=resolve(`.verification/openrouter/broker-runs/${runId}`);mkdirSync(root,{recursive:true,mode:0o700});
const prefix=`gab-${runId}`,dataNet=`${prefix}-data`,providerNet=`${prefix}-provider`,otherNet=`${prefix}-other`;
const provider=`${prefix}-provider`,postgres=`${prefix}-postgres`,redis=`${prefix}-redis`,canary=`${prefix}-canary`;
const credential=`gate-a-sentinel-${randomBytes(24).toString('hex')}`,credentialHash=digest(credential);
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const installationId=randomUUID(),checks=[],containers=new Set(),networks=[];
const clientCode=`${root}/client-code`;mkdirSync(clientCode,{mode:0o700});
for(const file of ['ipc-transport.mjs','broker-client.mjs','broker-workflow.mjs','fixture.mjs'])copyFileSync(`scripts/openrouter-verification/${file}`,`${clientCode}/${file}`);
const clientMount=['--mount',`type=bind,src=${clientCode},dst=/verification,readonly`];
const control=`${root}/control`;mkdirSync(control,{mode:0o700});writeFileSync(`${control}/scenario.json`,JSON.stringify({mode:'success'}));
let stage='setup',activeBroker;
const evidence={runId,scope:process.argv.includes('--workflow-only')?'workflow-only':'full',head:build.head,build,checks,commands:[],providerRequests:'synthetic only',liveRequests:0};
function docker(args,input,allowFailure=false){
 const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:180000,maxBuffer:20000000});
 if(r.status!==0&&!allowFailure){
  if(args.includes('/verification/broker-workflow.mjs')){try{const message=JSON.parse(r.stdout.trim().split('\n').at(-1));console.error(JSON.stringify({workflowStatus:message.status,workflowStage:message.stage}));}catch{/* no raw errors */}}
  throw new Error(`DOCKER_${args[0]}_FAILED`);
 }
 return allowFailure?r:r.stdout;
}
const hardened=['--user',`${process.getuid()}:${process.getgid()}`,'--cap-drop','ALL','--security-opt','no-new-privileges:true','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m'];
function start(name,args){containers.add(name);return docker(['run','-d','--name',name,...args]).trim();}
function stop(name){docker(['rm','-f','-v',name],undefined,true);containers.delete(name);}
function mode(value){writeFileSync(`${control}/scenario.json`,JSON.stringify({mode:value}));}
function providerAdmin(path,method='GET'){
 return JSON.parse(docker(['exec',provider,'node','-e',`const h=require('node:http');const r=h.request({host:'127.0.0.1',port:8081,path:${JSON.stringify(path)},method:${JSON.stringify(method)}},s=>{let b='';s.on('data',c=>b+=c);s.on('end',()=>process.stdout.write(b));});r.on('error',()=>process.exit(1));r.end();`]));
}
async function wait(fn){for(let i=0;i<100;i++){try{if(await fn())return;}catch{/* readiness only, never retry inference */}await new Promise(r=>setTimeout(r,100));}throw new Error('READINESS_TIMEOUT');}
function fixture(){
 const id=randomUUID(),dir=`${root}/case-${id}`;mkdirSync(dir,{mode:0o700});
 for(const sub of ['authorization','approval','trust','secret','ipc','workload'])mkdirSync(`${dir}/${sub}`,{mode:0o700});
 const tasks=['job-analysis','rubric-draft'].map(task=>({task,operationId:randomUUID(),workloadHash:digest({description,requirements:task==='job-analysis'?[]:[requirement]})}));
 const approval={version:1,purpose:'gate-a-synthetic',authorizationId:id,installationId,sourceDigest:build.sourceDigest,brokerImage:build.image,applicationImage:build.applicationImage,model:'verification/synthetic',provider:'Synthetic',endpoint:PROVIDER_ENDPOINT,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+1800000).toISOString(),maxOutputTokens:4096,maxRequestBytes:65536,tasks};
 const trust=Object.fromEntries(['authorizationId','installationId','sourceDigest','brokerImage','applicationImage'].map(k=>[k,approval[k]]));
 writeFileSync(`${dir}/trust/installation.json`,JSON.stringify(trust),{mode:0o600});writeFileSync(`${dir}/trust/owner-public.pem`,publicKey.export({type:'spki',format:'pem'}),{mode:0o600});
 writeFileSync(`${dir}/secret/provider-key`,credential,{mode:0o600});
 const f={id,dir,approval,trust,broker:`${prefix}-b-${id}`,client:`${prefix}-c-${id}`};
 signed(f);initializeCounter(`${dir}/authorization/ledger.sqlite`,digest(approval));
 return f;
}
function signed(f){writeFileSync(`${f.dir}/approval/approval.json`,JSON.stringify({approval:f.approval,signature:sign(null,Buffer.from(canonical(f.approval)),privateKey).toString('base64')}),{mode:0o600});}
function request(f,index=0){const t=f.approval.tasks[index],contract=contracts.contract(t.task),data={description,requirements:t.task==='job-analysis'?[]:[requirement]};return {operationId:t.operationId,task:t.task,body:{model:f.approval.model,messages:[{role:'system',content:contract.system},{role:'user',content:JSON.stringify({correlationId:t.operationId,data})}],max_tokens:4096,stream:false,provider:{only:['Synthetic'],order:['Synthetic'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true},response_format:{type:'json_schema',json_schema:{name:t.task.replaceAll('-','_'),strict:true,schema:contract.jsonSchema}}}};}
function brokerArgs(f,readOnly=false){return [...hardened,'--network',providerNet,'--mount',`type=bind,src=${f.dir}/authorization,dst=/authorization${readOnly?',readonly':''}`,'--mount',`type=bind,src=${f.dir}/approval,dst=/approval,readonly`,'--mount',`type=bind,src=${f.dir}/trust,dst=/trust,readonly`,'--mount',`type=bind,src=${f.dir}/secret,dst=/run/secrets,readonly`,'--mount',`type=bind,src=${f.dir}/ipc,dst=/ipc`,build.image,'node','/verification/broker.mjs'];}
function brokerReady(f){return docker(['exec',f.broker,'node','-e',"const h=require('node:http');const r=h.request({socketPath:'/ipc/broker.sock',path:'/ready'},s=>{s.resume();s.on('end',()=>process.exit(s.statusCode===403?0:1));});r.on('error',()=>process.exit(1));r.end();"],undefined,true).status===0;}
async function launch(f,{invalid=false,readOnly=false}={}){
 mode('success');providerAdmin('/reset','POST');start(f.broker,brokerArgs(f,readOnly));activeBroker=f.broker;
 if(invalid){await wait(()=>JSON.parse(docker(['inspect',f.broker]))[0].State.Running===false);assert.notEqual(JSON.parse(docker(['inspect',f.broker]))[0].State.ExitCode,0);return;}
 await wait(()=>brokerReady(f));
 start(f.client,[...hardened,...clientMount,'--network',dataNet,'--mount',`type=bind,src=${f.dir}/ipc,dst=/ipc,readonly`,build.applicationImage,'node','-e','setInterval(()=>{},10000)']);
}
function send(f,envelopes,path='/inference'){
 const payload=Array.isArray(envelopes)?{requests:envelopes.map(envelope=>({envelope,path}))}:{envelope:envelopes,path};
 const text=docker(['exec','-i',f.client,'node','/verification/broker-client.mjs'],JSON.stringify(payload));assert(!text.includes(credential));return JSON.parse(text);
}
function consumed(f){return counterState(`${f.dir}/authorization/ledger.sqlite`,digest(f.approval)).consumed;}
function passed(name,detail={}){checks.push({name,status:'PASS',...detail});console.log(JSON.stringify({check:name,status:'PASS'}));}
async function deniedStartup(name,mutate){const f=fixture();try{mutate(f);await launch(f,{invalid:true});assert.equal(providerAdmin('/stats').posts,0);passed(name,{providerPosts:0});}finally{stop(f.broker);}}
async function rejected(name,mutate,path='/inference'){const f=fixture();try{await launch(f);const envelope=request(f);mutate(envelope);const [result]=send(f,envelope,path);assert.equal(result.status,403);assert.equal(providerAdmin('/stats').posts,0);assert.equal(consumed(f),0);passed(name,{providerPosts:0,admissions:0});}finally{stop(f.broker);stop(f.client);}}
try {
 for(const [name,internal] of [[dataNet,true],[providerNet,true],[otherNet,false]]){docker(['network','create',...(internal?['--internal']:[]),name]);networks.push(name);}
 start(provider,[...hardened,'--network',providerNet,'--network-alias','provider','--env',`SENTINEL_DIGEST=${credentialHash}`,'--mount',`type=bind,src=${control},dst=/control,readonly`,build.image,'node','/verification/provider-substitute.mjs']);
 await wait(()=>providerAdmin('/stats').posts===0);
 if(!process.argv.includes('--workflow-only')) {
 stage='approval-negative';
 await deniedStartup('01 missing approval',f=>unlinkSync(`${f.dir}/approval/approval.json`));
 await deniedStartup('02 modified approval signature',f=>{const s=JSON.parse(readFileSync(`${f.dir}/approval/approval.json`));s.approval.model='changed';writeFileSync(`${f.dir}/approval/approval.json`,JSON.stringify(s));});
 await deniedStartup('03 expired approval',f=>{f.approval.issuedAt=new Date(Date.now()-10000).toISOString();f.approval.expiresAt=new Date(Date.now()-1000).toISOString();signed(f);});
 await deniedStartup('04 wrong execution purpose',f=>{f.approval.purpose='live';signed(f);});
 await deniedStartup('05 changed source/image identity',f=>{f.approval.sourceDigest='0'.repeat(64);f.approval.brokerImage=`sha256:${'0'.repeat(64)}`;signed(f);});
 await deniedStartup('05b changed image identity alone',f=>{f.approval.brokerImage=`sha256:${'0'.repeat(64)}`;signed(f);});
 await deniedStartup('06 changed approved route/model',f=>{f.approval.endpoint='https://openrouter.ai/api/v1/chat/completions';f.approval.model='changed';signed(f);});
 await deniedStartup('14 missing ledger',f=>unlinkSync(`${f.dir}/authorization/ledger.sqlite`));
 await deniedStartup('15 corrupted ledger',f=>writeFileSync(`${f.dir}/authorization/ledger.sqlite`,'corrupt'));
 stage='request-negative';
 await rejected('07 wrong operation',e=>{e.operationId=randomUUID();});
 await rejected('08 wrong task',e=>{e.task='catalog';});
 await rejected('21 arbitrary destination',e=>{e.url='https://example.invalid';});
 await rejected('22 catalog endpoint',()=>{},'/models');
 await rejected('23 generic proxy request',e=>{e.method='GET';e.url='http://provider:8081/stats';});
 await rejected('approved workload identity',e=>{const u=JSON.parse(e.body.messages[1].content);u.data.description='Changed';e.body.messages[1].content=JSON.stringify(u);});
 await rejected('approved request schema',e=>{e.body.response_format.json_schema.schema={};});
 await rejected('token limit',e=>{e.body.max_tokens=4097;});
 await rejected('request provider/model pin',e=>{e.body.model='changed';});
 await rejected('12 run name cannot expand authorization',e=>{e.runName='fresh-run';});
 stage='admission';
 {
  const f=fixture();try{await launch(f);assert.equal(send(f,request(f))[0].status,200);assert.equal(send(f,request(f))[0].status,403);passed('09 duplicate operation',{providerPosts:providerAdmin('/stats').posts});
   const duplicate=request(f,1);duplicate.task='job-analysis';assert.equal(send(f,duplicate)[0].status,403);assert.equal(providerAdmin('/stats').posts,1);passed('10 duplicate task',{providerPosts:1});
   assert.equal(send(f,request(f,1))[0].status,200);assert.equal(consumed(f),2);assert.equal(send(f,request(f))[0].status,403);assert.equal(providerAdmin('/stats').posts,2);passed('11 third request',{providerPosts:2,admissions:2});
   docker(['restart',f.broker]);await wait(()=>brokerReady(f));
   assert.equal(send(f,request(f))[0].status,403);assert.equal(providerAdmin('/stats').posts,2);assert.equal(consumed(f),2);passed('13 broker restart preserves consumption',{providerPosts:2,admissions:2});
  }finally{stop(f.broker);stop(f.client);}
 }
 {const f=fixture();try{await launch(f,{readOnly:true});assert.equal(send(f,request(f))[0].status,403);assert.equal(providerAdmin('/stats').posts,0);assert.equal(consumed(f),0);passed('16 read-only ledger',{providerPosts:0});}finally{stop(f.broker);stop(f.client);}}
 for(const [name,scenario] of [['17 timeout','timeout'],['18 connection interruption','interrupt'],['20 redirect','redirect'],['provider secret echo rejected','echo-secret']]){
  const f=fixture();try{await launch(f);mode(scenario);const result=send(f,request(f))[0];assert(result.status>=300);assert.equal(consumed(f),1);assert.equal(send(f,request(f))[0].status,403);const stats=providerAdmin('/stats');assert.equal(stats.posts,1);assert.equal(stats.redirects,0);passed(name,{providerPosts:1,admissions:1,redirectedRequests:0,billing:'UNKNOWN'});}finally{stop(f.broker);stop(f.client);}
 }
 {const f=fixture();try{await launch(f);mode('hold');const child=spawn('docker',['exec','-i',f.client,'node','/verification/broker-client.mjs'],{stdio:['pipe','ignore','ignore']});child.stdin.end(JSON.stringify({envelope:request(f)}));await wait(()=>providerAdmin('/stats').posts===1);docker(['kill','--signal','KILL',f.broker]);await new Promise(r=>child.once('exit',r));assert.equal(consumed(f),1);docker(['start',f.broker]);await wait(()=>brokerReady(f));assert.equal(send(f,request(f))[0].status,403);assert.equal(providerAdmin('/stats').posts,1);passed('19 broker crash after admission',{providerPosts:1,admissions:1,billing:'UNKNOWN'});}finally{stop(f.broker);stop(f.client);}}
 {const f=fixture();try{await launch(f);const responses=send(f,Array.from({length:12},(_,i)=>request(f,i%2)));assert.equal(responses.filter(r=>r.status===200).length,2);assert.equal(providerAdmin('/stats').posts,2);assert.equal(consumed(f),2);passed('28 concurrent requests',{contenders:12,providerPosts:2,admissions:2});}finally{stop(f.broker);stop(f.client);}}
 }
 for(const attack of responseAttackModes){const f=fixture();try{await launch(f);mode(attack);const result=send(f,request(f))[0];assert(result.status>=400);assert.equal(result.body,'{"error":"PROVIDER_RESPONSE_REJECTED"}');assert.equal(consumed(f),1);assert.equal(send(f,request(f))[0].status,403);assert.equal(providerAdmin('/stats').posts,1);const logs=docker(['logs',f.broker],undefined,true);assert(!`${logs.stdout}${logs.stderr}`.includes(credential));passed(`GA-F01 ${attack}`,{admissions:1,providerPosts:1,ipcPayload:'generic rejection'});}finally{stop(f.broker);stop(f.client);}}
 stage='network-and-workflow';
 const f=fixture();await launch(f);
 evidence.fixtureAuthorization=f.approval;
 const providerIP=JSON.parse(docker(['inspect',provider]))[0].NetworkSettings.Networks[providerNet].IPAddress;
 start(canary,[...hardened,'--network',otherNet,build.image,'node','-e',"require('node:http').createServer((q,s)=>s.end('canary')).listen(8082,'0.0.0.0')"]);
 const canaryIP=JSON.parse(docker(['inspect',canary]))[0].NetworkSettings.Networks[otherNet].IPAddress;
 const normal=JSON.parse(docker(['inspect','smart-recruit-ai-postgres-1','smart-recruit-ai-worker-1']));
 const targets=[{name:'provider',host:providerIP,port:8081},{name:'canary on other network',host:canaryIP,port:8082},...normal.map((c,i)=>({name:i?'normal worker':'normal database',host:Object.values(c.NetworkSettings.Networks)[0].IPAddress,port:i?3001:5432}))];
 const probe=`const net=require('node:net');const targets=${JSON.stringify(targets)};Promise.all(targets.map(t=>new Promise(resolve=>{const s=net.connect(t.port,t.host);const done=reachable=>{s.destroy();resolve({name:t.name,reachable});};s.setTimeout(500,()=>done(false));s.on('connect',()=>done(true));s.on('error',()=>done(false));}))).then(r=>process.stdout.write(JSON.stringify(r)));`;
 evidence.networkProbes=JSON.parse(docker(['exec',f.client,'node','-e',probe]));assert(evidence.networkProbes.every(p=>p.reachable===false));passed('24 application direct provider and other networks blocked',{probes:evidence.networkProbes});
 for(const service of ['api','worker']){
  const container=JSON.parse(docker(['inspect',`smart-recruit-ai-${service}-1`]))[0];
  assert(container.Config.Env.includes('AI_PROVIDER=mock'));
  assert(!container.Mounts.some(m=>['/run/secrets','/authorization','/ipc'].some(p=>m.Destination===p||m.Destination.startsWith(`${p}/`))));
 }
 passed('25 normal API/worker cannot access broker mounts');
 stage='database-setup';
 const password=randomBytes(24).toString('hex');
 start(postgres,['--network',dataNet,'--network-alias','postgres','--env','POSTGRES_DB=openrouter_verification','--env','POSTGRES_USER=verification_owner','--env',`POSTGRES_PASSWORD=${password}`,'postgres:17.7-alpine']);
 start(redis,['--network',dataNet,'--network-alias','redis','redis:7.4.7-alpine','redis-server','--requirepass',password]);
 await wait(()=>docker(['exec',postgres,'pg_isready','-h','127.0.0.1','-U','verification_owner','-d','openrouter_verification'],undefined,true).status===0);
 const sql=text=>docker(['exec','-i',postgres,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','verification_owner','-d','openrouter_verification'],text);
 sql(`CREATE ROLE smart_recruit_runtime LOGIN PASSWORD '${password}';REVOKE CREATE ON SCHEMA public FROM PUBLIC;GRANT USAGE ON SCHEMA public TO smart_recruit_runtime;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO smart_recruit_runtime;CREATE TABLE "_prisma_migrations" (id text);`);
 for(const dir of readdirSync('apps/api/prisma/migrations').filter(n=>/^\d/.test(n)).sort())sql(readFileSync(`apps/api/prisma/migrations/${dir}/migration.sql`,'utf8'));
 writeFileSync(`${f.dir}/workload/workload.json`,JSON.stringify({tasks:f.approval.tasks.map(t=>({...t,idempotencyKey:randomUUID()}))}),{mode:0o600});
 const appEnv={NODE_ENV:'test',AI_PROVIDER:'mock',DATABASE_URL:`postgresql://smart_recruit_runtime:${password}@postgres:5432/openrouter_verification?schema=public`,REDIS_URL:`redis://:${password}@redis:6379/0`,PUBLIC_APP_URL:'http://127.0.0.1:8080',CORS_ORIGIN:'http://127.0.0.1:8080',S3_ENDPOINT:'http://127.0.0.1:9',S3_REGION:'us-east-1',S3_BUCKET:'synthetic',S3_ACCESS_KEY:'synthetic',S3_SECRET_KEY:randomBytes(24).toString('hex'),SMTP_HOST:'127.0.0.1',SMTP_PORT:'9',SMTP_FROM:'verification@example.test',AUTH_KEY_ID:'v1',NOTIFICATION_KEY_VERSION:'v1',AUTH_SIGNING_KEY:randomBytes(32).toString('hex'),CSRF_KEY:randomBytes(32).toString('hex'),NOTIFICATION_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
 for(const attack of responseAttackModes){
  const bad=fixture();try{await launch(bad);mode(attack);
   writeFileSync(`${bad.dir}/workload/workload.json`,JSON.stringify({rejectResponse:true,tasks:bad.approval.tasks.map(t=>({...t,idempotencyKey:randomUUID()}))}),{mode:0o600});
   const name=`${prefix}-rejected-${attack}`;containers.add(name);
   const out=docker(['run','--name',name,...hardened,...clientMount,'--network',dataNet,...Object.entries(appEnv).flatMap(([k,v])=>['--env',`${k}=${v}`]),'--mount',`type=bind,src=${bad.dir}/ipc,dst=/ipc,readonly`,'--mount',`type=bind,src=${bad.dir}/workload,dst=/workload,readonly`,build.applicationImage,'node','/verification/broker-workflow.mjs']);
   assert(!out.includes(credential));const proof=JSON.parse(out.trim().split('\n').at(-1));assert.equal(proof.status,'PASS');assert.equal(proof.artifacts,0);assert.equal(consumed(bad),1);assert.equal(providerAdmin('/stats').posts,1);passed(`GA-F01 artifact rejection ${attack}`,{artifacts:0,admissions:1});
  }finally{stop(bad.broker);stop(bad.client);}
 }
 mode('success');providerAdmin('/reset','POST');
 const workflowName=`${prefix}-workflow`;containers.add(workflowName);
 stage='application-workflow';
 const output=docker(['run','--name',workflowName,...hardened,...clientMount,'--network',dataNet,...Object.entries(appEnv).flatMap(([k,v])=>['--env',`${k}=${v}`]),'--mount',`type=bind,src=${f.dir}/ipc,dst=/ipc,readonly`,'--mount',`type=bind,src=${f.dir}/workload,dst=/workload,readonly`,build.applicationImage,'node','/verification/broker-workflow.mjs']);
 assert(!output.includes(credential));evidence.workflow=JSON.parse(output.trim().split('\n').at(-1));assert.equal(evidence.workflow.status,'PASS');assert.equal(providerAdmin('/stats').posts,2);assert.equal(providerAdmin('/stats').authenticated,2);assert.equal(consumed(f),2);
 passed('26 application environment and child processes contain no credential');passed('authenticated API -> production processor -> broker -> persistence',{providerPosts:2});
 const expected=approvedInventory(JSON.parse(readFileSync(`${f.dir}/approval/approval.json`)),f.trust,publicKey,build,evidence.workflow.requestBindings,providerAdmin('/stats').receipts);
 evidence.expectedInventory=expected;
 const independent=providerAdmin('/stats').receipts;
 evidence.providerReceipts=independent;
 evidence.reconciliation=reconcile(evidence.workflow.records,independent,'synthetic-independent-fixture',expected);assert.equal(evidence.reconciliation.status,'PASS');assert.equal(reconcile([],independent,'synthetic-independent-fixture',expected).status,'INCOMPLETE');passed('29 incomplete reconciliation fails');
 const dbDump=docker(['exec',postgres,'pg_dump','-U','verification_owner','-d','openrouter_verification','--data-only']);assert(!dbDump.includes(credential));
 const redisData=docker(['exec',redis,'sh','-c',`REDISCLI_AUTH="$1" redis-cli --raw EVAL 'local r={} for _,k in ipairs(redis.call("KEYS","*")) do table.insert(r,k) table.insert(r,redis.call("DUMP",k)) end return r' 0`,'verify',password]);assert(!redisData.includes(credential));
 const logs=[...containers].map(name=>docker(['logs',name],undefined,true)).map(r=>`${r.stdout||''}${r.stderr||''}`).join('\n');assert(!logs.includes(credential));assert(!logs.includes('Bearer '+credential));
 stage='image-and-container-proof';
 const inspected=JSON.parse(docker(['inspect',f.broker,f.client,workflowName,provider]));
 evidence.containers=inspected.map(c=>({name:c.Name,image:c.Image,networkMode:c.HostConfig.NetworkMode,networks:Object.keys(c.NetworkSettings.Networks),privileged:c.HostConfig.Privileged,capDrop:c.HostConfig.CapDrop,securityOpt:c.HostConfig.SecurityOpt,readOnlyRoot:c.HostConfig.ReadonlyRootfs,portBindings:c.HostConfig.PortBindings,mounts:c.Mounts.map(m=>({destination:m.Destination,rw:m.RW,type:m.Type}))}));
 for(const c of inspected){assert(!(c.Config.Env||[]).some(v=>v.includes(credential)));assert.equal(c.Image,[`/${f.client}`,`/${workflowName}`].includes(c.Name)?build.applicationImage:build.image);assert.equal(c.HostConfig.Privileged,false);assert(c.HostConfig.CapDrop.includes('ALL'));assert(c.HostConfig.SecurityOpt.includes('no-new-privileges:true'));assert.equal(c.HostConfig.ReadonlyRootfs,true);assert.equal(Object.keys(c.HostConfig.PortBindings||{}).length,0);assert(!c.Mounts.some(m=>m.Destination.includes('docker.sock')));}
 const imageInfo=JSON.parse(docker(['image','inspect',build.image,build.applicationImage]));assert.deepEqual(imageInfo[0].RootFS.Layers.slice(0,imageInfo[1].RootFS.Layers.length),imageInfo[1].RootFS.Layers);
 const tar=`${root}/image.tar`;docker(['image','save','-o',tar,build.image]);
 const scan=spawnSync('python3',['scripts/openrouter-verification/scan-image.py',tar,`${f.dir}/secret/provider-key`],{encoding:'utf8',timeout:120000,maxBuffer:1000000});assert.equal(scan.status,0);evidence.imageScan=JSON.parse(scan.stdout);unlinkSync(tar);
 assert(!JSON.stringify(evidence).includes(credential));passed('27 credential absent from database/logs/evidence/image layers',{imageScan:evidence.imageScan});
 const legacy=spawnSync(process.execPath,['scripts/openrouter-smoke.mjs','--approved-live'],{encoding:'utf8'});assert.equal(legacy.status,1);passed('30 legacy smoke disabled');
 evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.failedStage=stage;evidence.failureType=error.name;if(/^DOCKER_[a-z]+_FAILED$/.test(error.message))evidence.failureCode=error.message;console.error(JSON.stringify({status:'FAIL',stage,type:error.name,code:evidence.failureCode}));process.exitCode=1;}
finally{
 for(const name of [...containers].reverse())stop(name);
 for(const name of networks.reverse())docker(['network','rm',name],undefined,true);
 evidence.finishedAt=new Date().toISOString();writeFileSync(`${root}/result.json`,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:evidence.status,evidence:`${root}/result.json`,checks:checks.length,activeBroker:activeBroker?true:false}));
}
