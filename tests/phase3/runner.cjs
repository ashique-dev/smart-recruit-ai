const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');
const {spawn}=require('node:child_process');
const load=createRequire('/app/package.json');
const url=new URL(process.env.DATABASE_URL);url.pathname=`/${process.env.PHASE3_TEST_DB}`;process.env.DATABASE_URL=url.toString();process.env.AI_PROVIDER='mock';
load('reflect-metadata');
const {NestFactory}=load('@nestjs/core');const {ValidationPipe}=load('@nestjs/common');
const {AppModule}=load('/app/dist/app.module');const {Infrastructure}=load('/app/dist/common/infrastructure');
const {AuthService}=load('/app/dist/auth/auth.service');const {Security}=load('/app/dist/auth/security');
const {AiProcessor,AiRuntime}=load('/app/dist/ai-gateway/runtime');const {AiFailure}=load('/app/dist/ai-gateway/gateway');
const {redisOptions}=load('/app/dist/common/infrastructure');const {Queue}=load('bullmq');const {hash}=load('/app/dist/ai-gateway/gateway');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(100);}throw new Error('POLL_TIMEOUT');}
(async()=>{
 const app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');
 const base=await app.getUrl(),infra=app.get(Infrastructure),db=infra.prisma,auth=app.get(AuthService),security=app.get(Security),processor=new AiProcessor(infra);let runtime;
 const csrf=security.csrf();
 async function call(path,body,token){const response=await fetch(`${base}/api/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{origin:infra.env.CORS_ORIGIN,'content-type':'application/json','x-csrf-token':csrf,cookie:`sr_csrf=${csrf}`,...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
 async function register(name){const session=await auth.register({email:`${randomUUID()}@example.test`,password:'Synthetic test password 123!',displayName:name,companyName:name});const identity=await security.verify(session.accessToken);const member=await db.companyMembership.findFirstOrThrow({where:{userId:identity.userId}});return {token:session.accessToken,identity,member};}
 async function expect(path,body,token,status=201){const result=await call(path,body,token);assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
 try{
 const a=await register('A'),b=await register('B'),viewer=await register('Viewer');await db.companyMembership.create({data:{companyId:a.member.companyId,userId:viewer.identity.userId,role:'VIEWER'}});await db.companyMembership.create({data:{companyId:b.member.companyId,userId:a.identity.userId,role:'VIEWER'}});
 const root=`companies/${a.member.companyId}/jobs`,other=`companies/${b.member.companyId}/jobs`;
 const body={title:'API engineer',description:'Build TypeScript APIs.',department:'Engineering',employmentType:'FULL_TIME',workArrangement:'REMOTE',location:'Remote',requirements:[]};
 const job=await expect(root,body,a.token),path=`${root}/${job.id}`;
 await expect(root,body,viewer.token,403);await expect(other,body,a.token,403);await expect(path,undefined,b.token,403);await expect(`${other}/${job.id}`,undefined,b.token,404);assert.deepEqual(await expect(other,undefined,b.token,200),[]);
 await expect(`${path}/status`,{status:'ACTIVE',revision:1},a.token,409);await expect(path,{...body,revision:1,companyId:b.member.companyId},a.token,400);
 const enqueue=async(task='job-analysis',revision=1,key=randomUUID())=>expect(`${path}/ai`,{task,revision,idempotencyKey:key},a.token);
 const key=randomUUID();const [one,two]=await Promise.all([enqueue('job-analysis',1,key),enqueue('job-analysis',1,key)]);assert.equal(one.operationId,two.operationId);assert.equal(await db.outboxEvent.count({where:{operationId:one.operationId}}),1);
 const data={companyId:a.member.companyId,operationId:one.operationId};await processor.process({...data,companyId:b.member.companyId});assert.equal(await db.usageRecord.count(),0);
 await Promise.all([processor.process(data),processor.process(data)]);assert.equal(await db.usageRecord.count({where:{operationId:one.operationId}}),1);assert.equal(await db.aIArtifact.count({where:{operationId:one.operationId}}),1);
 let detail=await expect(path,undefined,a.token,200);assert.equal(detail.requests[0].operation.status,'SUCCEEDED');const requirements=detail.artifacts[0].output.requirements;
 await expect(path,{...body,requirements,revision:1},a.token);await expect(path,{...body,requirements,revision:1},a.token,409);
 const draft=await enqueue('rubric-draft',2);await processor.process({companyId:a.member.companyId,operationId:draft.operationId});detail=await expect(path,undefined,a.token,200);let config=detail.configs[0];assert.equal(config.status,'DRAFT');
 const clean=c=>({key:c.key,label:c.label,description:c.description,weight:c.weight,anchors:c.anchors,evidenceRequirements:c.evidenceRequirements,requirementKeys:c.requirementKeys});
 const invalid=config.criteria.map(clean);invalid[0].weight=9999;await expect(`${path}/drafts`,{criteria:invalid,revision:2,configId:config.id,configRevision:1},a.token);await expect(`${path}/rubrics/${config.id}/approve`,{revision:2,idempotencyKey:randomUUID()},a.token,400);
 const valid=invalid.map(c=>({...c,weight:10000}));await expect(`${path}/drafts`,{criteria:valid,revision:2,configId:config.id,configRevision:2},a.token);
 const approvals=await Promise.all([call(`${path}/rubrics/${config.id}/approve`,{revision:3,idempotencyKey:randomUUID()},a.token),call(`${path}/rubrics/${config.id}/approve`,{revision:3,idempotencyKey:randomUUID()},a.token)]);assert.deepEqual(approvals.map(x=>x.status).sort(),[201,409]);
 await expect(`${path}/drafts`,{criteria:valid,revision:2,configId:config.id,configRevision:4},a.token,409);
 await assert.rejects(()=>db.$executeRaw`UPDATE "JobEvaluationConfig" SET "sourceDescription"='tampered' WHERE id=${config.id}::uuid`,e=>e.code==='P2010'&&e.meta.code==='23514');await assert.rejects(()=>db.$executeRaw`UPDATE "RubricCriterion" SET weight=1 WHERE "configId"=${config.id}::uuid`,e=>e.code==='P2010'&&e.meta.code==='23514');await assert.rejects(()=>db.$executeRaw`DELETE FROM "RubricCriterion" WHERE "configId"=${config.id}::uuid`,e=>e.code==='P2010'&&e.meta.code==='23514');
 await assert.rejects(()=>db.job.create({data:{...body,companyId:b.member.companyId,creatorMembershipId:a.member.id}}),e=>e.code==='P2003');
 await assert.rejects(()=>db.$executeRaw`UPDATE "AIArtifact" SET "outputHash"='tampered' WHERE "operationId"=${one.operationId}::uuid`,e=>e.code==='P2010'&&e.meta.code==='42501');
 for(const [suffix,payload] of [['',{...body,requirements,revision:2}],['/status',{status:'ACTIVE',revision:2}],['/drafts',{criteria:valid,revision:2}],['/ai',{task:'job-analysis',revision:2,idempotencyKey:randomUUID()}]])await expect(path+suffix,payload,viewer.token,403);
 const next=await expect(`${path}/drafts`,{criteria:valid,revision:2},a.token);assert.equal(next.version,2);assert.equal((await db.jobEvaluationConfig.findUniqueOrThrow({where:{id:config.id}})).status,'APPROVED');
 await expect(`${path}/rubrics/${next.id}/approve`,{revision:1,idempotencyKey:randomUUID()},viewer.token,403);await expect(`${other}/${job.id}/rubrics/${next.id}/approve`,{revision:1,idempotencyKey:randomUUID()},b.token,404);
 for(const [status,revision] of [['ACTIVE',2],['PAUSED',3],['ACTIVE',4],['CLOSED',5],['ARCHIVED',6]])await expect(`${path}/status`,{status,revision},a.token);
 await expect(path,{...body,requirements,revision:7},a.token,409);await expect(`${path}/status`,{status:'ACTIVE',revision:7},a.token,409);
 console.log('PASS jobs HTTP, roles, overlapping tenants, citations, weights, immutable versions, races and status guards');
 // A fresh job drives worker failure/recovery; no application data is reused.
 const fresh=await expect(root,body,a.token),freshPath=`${root}/${fresh.id}`;
 const sourceArtifact=await db.aIArtifact.findFirstOrThrow({where:{operationId:draft.operationId}});
 await assert.rejects(()=>db.jobEvaluationConfig.create({data:{companyId:a.member.companyId,jobId:fresh.id,version:1,sourceDescription:body.description,sourceHash:'test',requirements,artifactId:sourceArtifact.id}}),e=>e.code==='P2003');
 const request=async()=>expect(`${freshPath}/ai`,{task:'job-analysis',revision:1,idempotencyKey:randomUUID()},a.token);
 const original=processor.gateway.execute.bind(processor.gateway);
 const failure=await request();processor.gateway.execute=async()=>{throw new AiFailure('INVALID_OUTPUT',true);};await processor.process({companyId:a.member.companyId,operationId:failure.operationId});assert.equal((await db.processingOperation.findUniqueOrThrow({where:{id:failure.operationId}})).status,'RETRY_WAIT');await db.processingOperation.update({where:{id:failure.operationId},data:{availableAt:new Date(0)}});await processor.process({companyId:a.member.companyId,operationId:failure.operationId});assert.equal((await db.processingOperation.findUniqueOrThrow({where:{id:failure.operationId}})).status,'FAILED');assert.equal(await db.aIArtifact.count({where:{operationId:failure.operationId}}),0);
 const rate=await request();processor.gateway.execute=async()=>{throw new AiFailure('PROVIDER_RATE_LIMIT',true,2000);};for(let n=1;n<=4;n++){await db.processingOperation.update({where:{id:rate.operationId},data:{availableAt:new Date(0)}});await processor.process({companyId:a.member.companyId,operationId:rate.operationId});const op=await db.processingOperation.findUniqueOrThrow({where:{id:rate.operationId}});assert.equal(op.attemptCount,n);assert.equal(op.status,n===4?'FAILED':'RETRY_WAIT');}
 const stale=await request();processor.gateway.execute=async(...args)=>{await expect(`${freshPath}`,{...body,title:'Updated',revision:1},a.token);return original(...args);};await processor.process({companyId:a.member.companyId,operationId:stale.operationId});assert.equal((await db.processingOperation.findUniqueOrThrow({where:{id:stale.operationId}})).status,'FAILED');assert.equal(await db.aIArtifact.count({where:{operationId:stale.operationId}}),0);processor.gateway.execute=original;
 const pending=await expect(`${freshPath}/ai`,{task:'job-analysis',revision:2,idempotencyKey:randomUUID()},a.token);
 // Crash a real separate worker after it has persisted its attempt, before receiving output.
 const child=spawn(process.execPath,['/phase3/worker-child.cjs'],{env:process.env,stdio:['ignore','ignore','pipe']});let childError='';child.stderr.on('data',b=>childError+=b);await poll(async()=>{if(child.exitCode!==null)throw new Error(childError||'child exited');return await db.usageRecord.count({where:{operationId:pending.operationId}})===1;});child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));
 await db.processingOperation.update({where:{id:pending.operationId},data:{leaseExpiresAt:new Date(0)}});
 const prefix=`sr-${hash(new URL(infra.env.DATABASE_URL).pathname).slice(0,16)}`;const queue=new Queue('ai-drafting',{prefix,connection:redisOptions(infra.env.REDIS_URL)});await queue.obliterate({force:true});await queue.close();
 runtime=new AiRuntime(infra,processor);runtime.onModuleInit();await poll(async()=>(await db.processingOperation.findUniqueOrThrow({where:{id:pending.operationId}})).status==='SUCCEEDED');await runtime.onModuleDestroy();runtime=undefined;
 assert.equal(await db.aIArtifact.count({where:{operationId:pending.operationId}}),1);const usage=await db.usageRecord.findMany({where:{operationId:pending.operationId},orderBy:{attempt:'asc'}});assert.equal(usage.length,2);assert.equal(usage[0].outcome,'UNKNOWN');assert.equal(usage[1].outcome,'SUCCESS');assert.equal(usage[1].costStatus,'MOCK');
 await processor.process({companyId:a.member.companyId,operationId:pending.operationId});assert.equal(await db.aIArtifact.count({where:{operationId:pending.operationId}}),1);
 const budget=await expect(`${freshPath}/ai`,{task:'job-analysis',revision:2,idempotencyKey:randomUUID()},a.token);processor.gateway.settings.AI_DAILY_CALL_LIMIT=1;await processor.process({companyId:a.member.companyId,operationId:budget.operationId});assert.equal((await db.processingOperation.findUniqueOrThrow({where:{id:budget.operationId}})).failureCode,'AI_DAILY_BUDGET');assert.equal(await db.usageRecord.count({where:{operationId:budget.operationId}}),0);
 console.log('PASS bounded invalid-output retries, stale-result fencing, real process crash, Redis loss, durable outbox and usage');
 const cleanup=new Queue('ai-drafting',{prefix,connection:redisOptions(infra.env.REDIS_URL)});await cleanup.obliterate({force:true});await cleanup.close();
 }finally{await runtime?.onModuleDestroy();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
