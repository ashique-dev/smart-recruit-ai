import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {authorizedTransport} from './authorization.mjs';
import {initializeCounter,boundedTransport} from './limit.mjs';
import {description,requirement,syntheticResponse,designatedSettings} from './fixture.mjs';
import {generationRecord,applicationRecord,reconcile} from './evidence.mjs';
const load=createRequire('/app/package.json');
load('reflect-metadata');
const {NestFactory}=load('@nestjs/core'),{ValidationPipe}=load('@nestjs/common');
const {AppModule}=load('/app/dist/app.module'),{Infrastructure,redisOptions}=load('/app/dist/common/infrastructure');
const {AiProcessor}=load('/app/dist/ai-gateway/runtime'),{AiGateway,aiSettings,AiFailure}=load('/app/dist/ai-gateway/gateway');
const {JobsService}=load('/app/dist/jobs/jobs.service'),{SafeErrors}=load('/app/dist/common/safe-errors');
const settings=designatedSettings(aiSettings);
const denied=()=>new AiFailure('VERIFICATION_SEND_DENIED');
let stage='isolation', app;
const checks=[];
const check=name=>checks.push(name);
try {
  assert.equal(new URL(process.env.DATABASE_URL).pathname,'/openrouter_verification');
  assert.match(new URL(process.env.DATABASE_URL).hostname,/^orverify-[a-f0-9-]+-pg$/);
  assert.match(new URL(process.env.REDIS_URL).hostname,/^orverify-[a-f0-9-]+-redis$/);
  // Guard even accidental global fetch calls; provider transport below never uses global fetch.
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=(url,...args)=>{
    const parsed=new URL(url);
    if(parsed.hostname!=='127.0.0.1'||parsed.protocol!=='http:')throw new Error('NETWORK_DENIED');
    return nativeFetch(url,...args);
  };
  assert.throws(()=>globalThis.fetch('https://openrouter.ai/api/v1/models'),/NETWORK_DENIED/);
  app=await NestFactory.create(AppModule,{logger:false});
  app.setGlobalPrefix('api/v1');app.useGlobalFilters(new SafeErrors());
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  await app.listen(0,'127.0.0.1');
  const base=await app.getUrl(),infra=app.get(Infrastructure),db=infra.prisma;
  await infra.databaseReady(); assert.equal(await db.company.count(),0);
  assert.equal(await infra.redis.dbsize(),0);
  assert.equal((await db.$queryRaw`SELECT current_user AS role`)[0].role,'smart_recruit_runtime');
  assert.equal(await db.$queryRaw`SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS allowed`.then(r=>r[0].allowed),false);
  check('isolated database, runtime role, empty Redis, loopback and egress guard');
  const csrf=await fetch(`${base}/api/v1/auth/csrf`).then(r=>r.json()).then(r=>r.csrfToken);
  async function call(path,payload,token,status=201,csrfValue=csrf) {
    const response=await fetch(`${base}/api/v1/${path}`,{method:payload===undefined?'GET':'POST',headers:{origin:infra.env.CORS_ORIGIN,'content-type':'application/json',...(csrfValue===null?{}:{'x-csrf-token':csrfValue,cookie:`sr_csrf=${csrf}`}),...(token?{authorization:`Bearer ${token}`}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});
    assert.equal(response.status,status,'Unexpected HTTP status');return response.json();
  }
  async function register(name) {
    const session=await call('auth/register',{email:`${randomUUID()}@example.test`,password:'Synthetic test password 123!',displayName:name,companyName:name});
    const companies=await call('companies',undefined,session.accessToken,200);
    return {token:session.accessToken,companyId:companies[0].company.id};
  }
  stage='authenticated-workflow';
  const a=await register('Synthetic A'),b=await register('Synthetic B');
  const root=`companies/${a.companyId}/jobs`,other=`companies/${b.companyId}/jobs`;
  const body={title:'Synthetic API engineer',description,department:'Engineering',employmentType:'FULL_TIME',workArrangement:'REMOTE',location:'Remote',requirements:[]};
  await call(root,body,undefined,401);
  const job=await call(root,body,a.token),path=`${root}/${job.id}`;
  await call(path,undefined,b.token,403);await call(`${other}/${job.id}`,undefined,b.token,404);
  const processor=new AiProcessor(infra),captured=[];let sends=0;
  const transport=authorizedTransport('/authorization',JSON.parse(process.env.VERIFICATION_AUTHORIZATION),async(_url,options)=>{sends++;const response=syntheticResponse(options);captured.push(generationRecord(response));return Response.json(response);},denied);
  processor.gateway=new AiGateway(settings,transport);
  app.get(JobsService).gateway=new AiGateway(settings,transport);
  const rejectedPayload={task:'job-analysis',revision:1,idempotencyKey:randomUUID()};
  await call(`${path}/ai`,rejectedPayload,a.token,403,null);
  await call(`${path}/ai`,rejectedPayload,a.token,403,'invalid-csrf');
  await call(`${path}/ai`,{...rejectedPayload,revision:99},a.token,409);
  await call(`${path}/ai`,rejectedPayload,b.token,403);
  assert.equal(sends,0);assert.equal(await db.processingOperation.count(),0);assert.equal(await db.aIArtifact.count(),0);
  check('missing/invalid CSRF, stale revision and foreign tenant rejected with zero sends/operations/artifacts');
  const enqueue=(task,revision,key=randomUUID())=>call(`${path}/ai`,{task,revision,idempotencyKey:key},a.token);
  const key=randomUUID(),one=await enqueue('job-analysis',1,key),duplicate=await enqueue('job-analysis',1,key);
  assert.equal(one.operationId,duplicate.operationId);
  assert.equal(await db.outboxEvent.count({where:{operationId:one.operationId}}),1);
  const data={companyId:a.companyId,operationId:one.operationId};
  await processor.process({...data,companyId:b.companyId});assert.equal(sends,0);
  await Promise.all([processor.process(data),processor.process(data)]);await processor.process(data);assert.equal(sends,1);
  let detail=await call(path,undefined,a.token,200);
  assert.equal(detail.artifacts.length,1);assert.deepEqual(detail.artifacts[0].output.requirements,[requirement]);
  await call(path,{...body,requirements:detail.artifacts[0].output.requirements,revision:1},a.token);
  const two=await enqueue('rubric-draft',2);
  assert.equal(await db.outboxEvent.count({where:{operationId:two.operationId,topic:'ai-drafting'}}),1);
  // Explicit isolated queue delivery; no production outbox polling/runtime is started.
  const {Queue,Worker}=load('bullmq'),queueName=`verification-${randomUUID()}`,connection=redisOptions(infra.env.REDIS_URL);
  const queue=new Queue(queueName,{connection}),worker=new Worker(queueName,j=>processor.process(j.data),{connection,concurrency:2});
  worker.on('error',()=>{});
  try {
    await worker.waitUntilReady();
    const data={companyId:a.companyId,operationId:two.operationId};
    const jobs=await Promise.all([queue.add('draft',data,{attempts:1}),queue.add('duplicate',data,{attempts:1})]);
    let done=false;
    for(let n=0;n<200;n++){if((await Promise.all(jobs.map(j=>j.getState()))).every(s=>s==='completed')){done=true;break;}await new Promise(r=>setTimeout(r,50));}
    assert(done,'queue delivery timeout');
  } finally {await worker.close();await queue.obliterate({force:true});await queue.close();}
  check('isolated BullMQ duplicate delivery invokes real processor once; production outbox polling not exercised');
  detail=await call(path,undefined,a.token,200);assert.equal(sends,2);assert.equal(detail.artifacts.length,2);
  assert.equal(detail.configs.length,1);assert.equal(detail.configs[0].status,'DRAFT');assert.equal(detail.configs[0].criteria[0].weight,10000);
  await call(path,undefined,b.token,403);await call(`${path}/ai`,{task:'job-analysis',revision:2,idempotencyKey:randomUUID()},b.token,403);
  const rows=await db.usageRecord.findMany({where:{companyId:a.companyId},orderBy:{createdAt:'asc'}});
  assert.equal(rows.length,2);assert(rows.every(r=>r.settledAt&&r.mode==='openrouter'&&r.costStatus==='ACTUAL'));
  const records=[];
  for(const row of rows)records.push(applicationRecord(row,await db.aiRequest.findUniqueOrThrow({where:{operationId:row.operationId}})));
  // A separately constructed provider-generation fixture, not a copy of the application ledger.
  const independent=[one,two].map(op=>({providerGenerationId:`gen-${op.operationId}`,provider:'Synthetic',model:'verification/synthetic',inputTokens:100,outputTokens:50,cacheReadTokens:0,cacheWriteTokens:5,providerReportedCost:'0.00100000'}));
  writeFileSync('/evidence/application.json',JSON.stringify(records,null,2)+'\n',{mode:0o600});
  writeFileSync('/evidence/generations.synthetic.json',JSON.stringify(independent,null,2)+'\n',{mode:0o600});
  const expected=[];
  for(const [operation,task] of [[one,'job-analysis'],[two,'rubric-draft']]) {
    const request=await db.aiRequest.findUniqueOrThrow({where:{operationId:operation.operationId}});
    expected.push({operationId:operation.operationId,aiRequestId:request.id,task,providerGenerationId:`gen-${operation.operationId}`});
  }
  writeFileSync('/evidence/expected.json',JSON.stringify(expected,null,2)+'\n',{mode:0o600});
  const reconciliation=reconcile(records,independent,'synthetic-independent-fixture',expected);
  assert.equal(reconciliation.status,'PASS');
  assert(reconciliation.comparisons.every(r=>r.reconciliation==='MATCH'));
  assert.equal(await db.usageRecord.count({where:{companyId:b.companyId}}),0);
  check('authenticated two-tenant analysis -> review/save -> rubric -> persisted artifacts and usage');
  check('duplicate submission/delivery and tenant read/write/processor denial');
  const third=await enqueue('job-analysis',2);await processor.process({companyId:a.companyId,operationId:third.operationId});
  assert.equal(sends,2);assert.equal(await db.aIArtifact.count({where:{operationId:third.operationId}}),0);
  assert.equal((await db.processingOperation.findUniqueOrThrow({where:{id:third.operationId}})).status,'FAILED');
  assert.equal((await db.usageRecord.findFirstOrThrow({where:{operationId:third.operationId}})).outcome,'VERIFICATION_SEND_DENIED');
  check('third request denied at transport before send');

  stage='synthetic-failures';
  const scenarioRoot=`/evidence/scenarios-${randomUUID()}`;mkdirSync(scenarioRoot,{mode:0o700});
  const failures=[['401','PROVIDER_REJECTED'],['429','PROVIDER_RATE_LIMIT'],['500','PROVIDER_UNAVAILABLE'],['timeout','PROVIDER_TIMEOUT_OR_NETWORK'],['interruption','PROVIDER_TIMEOUT_OR_NETWORK'],['json','INVALID_OUTPUT'],['schema','INVALID_OUTPUT'],['missing-usage',null],['missing-id',null]];
  const scenarioEvidence=[];
  for(const [kind,expected] of failures) {
    const fresh=await call(root,body,a.token),freshPath=`${root}/${fresh.id}`;
    const op=await call(`${freshPath}/ai`,{task:'job-analysis',revision:1,idempotencyKey:randomUUID()},a.token);
    const counter=`${scenarioRoot}/${kind}.sqlite`;initializeCounter(counter);let count=0;
    const send=async(_url,options)=>{
      count++;const response=syntheticResponse(options);
      if(['401','429','500'].includes(kind))return Response.json({error:{message:'DO_NOT_REPORT_PROVIDER_ERROR'}},{status:Number(kind)});
      if(kind==='timeout')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('DO_NOT_REPORT_TIMEOUT')),{once:true}));
      if(kind==='interruption')throw new Error('DO_NOT_REPORT_CONNECTION');
      if(kind==='json')return new Response('{');
      if(kind==='schema')response.choices[0].message.content='{}';
      if(kind==='missing-usage')delete response.usage;
      if(kind==='missing-id')delete response.id;
      return Response.json(response);
    };
    processor.gateway=new AiGateway(settings,boundedTransport(counter,send,denied));
    await processor.process({companyId:a.companyId,operationId:op.operationId});
    const row=await db.usageRecord.findFirstOrThrow({where:{operationId:op.operationId}});
    assert.equal(row.outcome,expected||'SUCCESS');assert.equal(count,1);
    if(kind==='missing-usage'){assert.equal(row.cost,null);assert.equal(row.inputTokens,null);assert.equal(row.cacheReadTokens,null);}
    if(kind==='missing-id')assert.equal(row.providerGenerationId,null);
    // Explicit retry delivery cannot send again, even for retryable errors.
    await db.processingOperation.update({where:{id:op.operationId},data:{availableAt:new Date(0)}});
    await processor.process({companyId:a.companyId,operationId:op.operationId});assert.equal(count,1);
    await db.processingOperation.update({where:{id:op.operationId},data:{status:'FAILED',leaseExpiresAt:null}});
    scenarioEvidence.push({scenario:kind,...applicationRecord(row,await db.aiRequest.findUniqueOrThrow({where:{operationId:op.operationId}}))});
  }
  check('401/429/500, timeout, interruption, malformed JSON/schema, missing usage/id; retries cannot resend');

  stage='stale-lease';
  const fresh=await call(root,body,a.token),stale=await call(`${root}/${fresh.id}/ai`,{task:'job-analysis',revision:1,idempotencyKey:randomUUID()},a.token);
  const staleCounter=`${scenarioRoot}/stale.sqlite`;initializeCounter(staleCounter);
  let release,entered;const ready=new Promise(r=>{entered=r;});const barrier=new Promise(r=>{release=r;});
  processor.gateway=new AiGateway(settings,boundedTransport(staleCounter,async(_url,options)=>{entered();await barrier;return Response.json(syntheticResponse(options));},denied));
  const pending=processor.process({companyId:a.companyId,operationId:stale.operationId});await ready;
  await db.processingOperation.update({where:{id:stale.operationId},data:{leaseExpiresAt:new Date(0)}});release();await pending;
  assert.equal(await db.aIArtifact.count({where:{operationId:stale.operationId}}),0);
  const staleRow=await db.usageRecord.findFirstOrThrow({where:{operationId:stale.operationId}});
  assert(staleRow.settledAt);
  const staleEvidence=applicationRecord(staleRow,await db.aiRequest.findUniqueOrThrow({where:{operationId:stale.operationId}}));
  check('stale lease accounts response without publishing artifact');

  stage='worker-crash';
  const crashJob=await call(root,body,a.token),crash=await call(`${root}/${crashJob.id}/ai`,{task:'job-analysis',revision:1,idempotencyKey:randomUUID()},a.token);
  const crashCounter=`${scenarioRoot}/crash.sqlite`;initializeCounter(crashCounter);
  const child=fork('/verification/crash-child.mjs',[],{env:{...process.env,VERIFICATION_COUNTER:crashCounter,VERIFICATION_COMPANY:a.companyId,VERIFICATION_OPERATION:crash.operationId},stdio:['ignore','ignore','ignore','ipc']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('CRASH_BARRIER_TIMEOUT'));},15000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error('CRASH_CHILD_EXIT'));});});
  const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;
  const before=await db.usageRecord.findFirstOrThrow({where:{operationId:crash.operationId}});
  assert.equal(before.settledAt,null);assert.equal(before.outcome,'UNKNOWN');assert.equal(before.cost,null);
  await db.processingOperation.update({where:{id:crash.operationId},data:{leaseExpiresAt:new Date(0)}});
  let recoverySends=0;processor.gateway=new AiGateway(settings,boundedTransport(crashCounter,async()=>{recoverySends++;throw new Error();},denied));
  await processor.process({companyId:a.companyId,operationId:crash.operationId});assert.equal(recoverySends,0);
  assert.equal(await db.aIArtifact.count({where:{operationId:crash.operationId}}),0);
  check('SIGKILL after provider response preserves unknown billing and consumed allowance across process restart');
  const crashRequest=await db.aiRequest.findUniqueOrThrow({where:{operationId:crash.operationId}});
  const crashEvidence=(await db.usageRecord.findMany({where:{operationId:crash.operationId},orderBy:{attempt:'asc'}})).map(r=>applicationRecord(r,crashRequest));
  const report={status:'PASS',mode:'synthetic',checks,captured,reconciliation,scenarios:scenarioEvidence,staleEvidence,crashEvidence};
  const serialized=JSON.stringify(report);
  for(const secret of [process.env.OPENROUTER_API_KEY,process.env.AUTH_SIGNING_KEY,process.env.CSRF_KEY,process.env.DATABASE_URL,a.token,b.token,csrf,'DO_NOT_REPORT'])assert(!serialized.includes(secret));
  check('allowlisted evidence excludes credentials, cookies, authorization and raw provider errors');
  console.log(JSON.stringify(report));
} catch {
  console.log(JSON.stringify({status:'FAIL',mode:'synthetic',stage,checks}));process.exitCode=1;
} finally {await app?.close();}
