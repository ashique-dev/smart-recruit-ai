import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {verificationTransport} from './ipc-transport.mjs';
import {description,requirement} from './fixture.mjs';
const load=createRequire('/app/package.json');load('reflect-metadata');
const {NestFactory}=load('@nestjs/core'),{ValidationPipe}=load('@nestjs/common');
const {AppModule}=load('/app/dist/app.module'),{Infrastructure}=load('/app/dist/common/infrastructure');
const {AiProcessor}=load('/app/dist/ai-gateway/runtime'),{AiGateway,aiSettings}=load('/app/dist/ai-gateway/gateway');
const {JobsService}=load('/app/dist/jobs/jobs.service'),{SafeErrors}=load('/app/dist/common/safe-errors');
let app,stage='startup';
try {
 assert(!process.env.OPENROUTER_API_KEY);assert.equal(process.env.AI_PROVIDER,'mock');
 assert(!existsSync('/run/secrets/provider-key'));assert(!existsSync('/authorization/ledger.sqlite'));assert(!existsSync('/approval/approval.json'));assert(!existsSync('/trust/owner-public.pem'));
 const child=spawnSync(process.execPath,['-e','process.stdout.write(String(Boolean(process.env.OPENROUTER_API_KEY)))'],{encoding:'utf8'});assert.equal(child.stdout,'false');
 const workload=JSON.parse(readFileSync('/workload/workload.json','utf8'));
 const routes=Object.fromEntries(['job-analysis','rubric-draft'].map(task=>[task,{model:'verification/synthetic',provider:'Synthetic',contextTokens:32768,maxOutputTokens:4096,inputCostPerMillion:1,outputCostPerMillion:2,structuredOutputs:true,zdr:true,verifiedAt:new Date().toISOString()}]));
 const settings=aiSettings({AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'broker-managed-placeholder',AI_MODEL_JOB_ANALYSIS:'verification/synthetic',AI_MODEL_RUBRIC_DRAFT:'verification/synthetic',AI_ROUTE_MANIFEST:JSON.stringify(routes),AI_TIMEOUT_MS:'4000'});
 stage='application-init';
 app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api/v1');app.useGlobalFilters(new SafeErrors());app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
 const infra=app.get(Infrastructure),processor=new AiProcessor(infra),gateway=new AiGateway(settings,verificationTransport);
 app.get(JobsService).gateway=gateway;processor.gateway=gateway;assert.equal(gateway.pin('job-analysis').mode,'openrouter');
 // Preallocate the two fixture IDs before owner approval, without bypassing request/auth/persistence logic.
 // Only identifier assignment is instrumented; all guards, inputs, revisions and writes remain production code.
 stage='fixture-identities';
 infra.prisma=infra.prisma.$extends({query:{processingOperation:{async create({args,query}) {
   const plan=workload.tasks.find(t=>t.task===args.data.kind);
   if(!plan||args.data.idempotencyKey!==plan.idempotencyKey)throw new Error('UNPLANNED_OPERATION');
   return query({...args,data:{...args.data,id:plan.operationId}});
 }}}});
 const db=infra.prisma;
 await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const csrf=await fetch(`${base}/api/v1/auth/csrf`).then(r=>r.json()).then(r=>r.csrfToken);
 async function call(path,body,token,status=201){const r=await fetch(`${base}/api/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{origin:infra.env.CORS_ORIGIN,'content-type':'application/json','x-csrf-token':csrf,cookie:`sr_csrf=${csrf}`,...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,status);return r.json();}
 async function account(){const s=await call('auth/register',{email:`${randomUUID()}@example.test`,password:'Synthetic test password 123!',displayName:'Broker fixture',companyName:'Synthetic'});const companies=await call('companies',undefined,s.accessToken,200);return {token:s.accessToken,companyId:companies[0].company.id};}
 stage='workflow';const a=await account(),b=await account(),root=`companies/${a.companyId}/jobs`;
 const body={title:'Synthetic API engineer',description,department:'Engineering',employmentType:'FULL_TIME',workArrangement:'REMOTE',location:'Remote',requirements:[]};
 const job=await call(root,body,a.token),path=`${root}/${job.id}`;
 await call(path,undefined,b.token,403);
 const enqueue=async(task,revision)=>{const planned=workload.tasks.find(t=>t.task===task);const op=await call(`${path}/ai`,{task,revision,idempotencyKey:planned.idempotencyKey},a.token);assert.equal(op.operationId,planned.operationId);return op;};
 const one=await enqueue('job-analysis',1);assert.equal(await db.outboxEvent.count({where:{operationId:one.operationId}}),1);
 await processor.process({companyId:a.companyId,operationId:one.operationId});
 if(workload.rejectResponse){
  const detail=await call(path,undefined,a.token,200);assert.equal(detail.artifacts.length,0);assert.equal(await db.aIArtifact.count({where:{companyId:a.companyId}}),0);
  console.log(JSON.stringify({status:'PASS',stage,artifacts:0,responseRejected:true}));
 }else{
 let detail=await call(path,undefined,a.token,200);assert.deepEqual(detail.artifacts[0].output.requirements,[requirement]);
 await call(path,{...body,requirements:detail.artifacts[0].output.requirements,revision:1},a.token);
 const two=await enqueue('rubric-draft',2);await processor.process({companyId:a.companyId,operationId:two.operationId});
 await processor.process({companyId:a.companyId,operationId:two.operationId});
 detail=await call(path,undefined,a.token,200);assert.equal(detail.artifacts.length,2);assert.equal(detail.configs[0].criteria[0].weight,10000);
 const rows=await db.usageRecord.findMany({where:{companyId:a.companyId},orderBy:{createdAt:'asc'}});assert.equal(rows.length,2);assert(rows.every(r=>r.mode==='openrouter'&&r.settledAt&&r.outcome==='SUCCESS'));
 const records=[];for(const r of rows){const request=await db.aiRequest.findUniqueOrThrow({where:{operationId:r.operationId}});records.push({task:request.task,operationId:r.operationId,aiRequestId:request.id,attempt:r.attempt,providerGenerationId:r.providerGenerationId,model:r.returnedModel,provider:r.provider,inputTokens:r.inputTokens,outputTokens:r.outputTokens,cacheReadTokens:r.cacheReadTokens,cacheWriteTokens:r.cacheWriteTokens,applicationRecordedCost:String(r.cost),settled:Boolean(r.settledAt),costStatus:r.costStatus});}
 const requestBindings=(await db.aiRequest.findMany({where:{companyId:a.companyId}})).map(r=>({operationId:r.operationId,task:r.task,aiRequestId:r.id}));
 console.log(JSON.stringify({status:'PASS',stage,records,requestBindings,credentialEnvironmentAbsent:true,credentialMountAbsent:true,ledgerMountAbsent:true,childCredentialAbsent:true,tenantDenied:true,productionProcessor:true}));
}
}catch{console.log(JSON.stringify({status:'FAIL',stage}));process.exitCode=1;}finally{await app?.close();}
