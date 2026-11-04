import type { Prisma } from '../../generated/client';
import type { Transaction } from '../auth/auth.service';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { inputSchema, type DraftingTask } from '@smart-recruit/ai-contracts';
import { Infrastructure, redisOptions } from '../common/infrastructure';
import { AiFailure, AiGateway, hash, hashJson } from './gateway';
import { json } from '../jobs/jobs.service';
export function settleAttempt(tx:Transaction,companyId:string,usageId:string,data:Prisma.UsageRecordUpdateManyMutationInput) {
 return tx.usageRecord.updateMany({where:{id:usageId,companyId,settledAt:null},data:{...data,settledAt:new Date()}});
}
const kinds=['job-analysis','rubric-draft'];
@Injectable()
export class AiProcessor {
 readonly gateway=new AiGateway();
 constructor(readonly infra:Infrastructure){}
 async process(data:{companyId:string;operationId:string}) {
  // Company lock serializes reservations across API and all worker replicas.
  const claim=await this.infra.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${data.companyId}::uuid FOR UPDATE`;
   const op=await tx.processingOperation.findFirst({where:{companyId:data.companyId,id:data.operationId,kind:{in:kinds}},include:{aiRequest:{include:{job:true}},company:true}});
   if(!op||!op.aiRequest||!['PENDING','RETRY_WAIT','RUNNING'].includes(op.status)||op.availableAt>new Date()||(op.leaseExpiresAt&&op.leaseExpiresAt>new Date()))return;
   const request=op.aiRequest;const settings=this.gateway.settings;
   let failure:string|undefined;
   if(op.deadlineAt<=new Date()||op.attemptCount>=4)failure='AI_ATTEMPTS_EXHAUSTED';
   if(op.company.status!=='ACTIVE'||request.job.status==='ARCHIVED'||request.job.revision!==request.jobRevision)failure='STALE_JOB';
   const pin=this.gateway.pin(request.task as DraftingTask);
   if(request.mode!==pin.mode||request.model!==pin.model||request.policyVersion!==pin.policyVersion||request.promptVersion!==pin.promptVersion||request.schemaVersion!==pin.schemaVersion)failure='AI_CONFIGURATION_CHANGED';
   if(hashJson(request.input)!==request.inputHash)failure='INPUT_HASH_MISMATCH';
   if(failure){await tx.processingOperation.update({where:{id:op.id},data:{status:'FAILED',failureCode:failure,leaseExpiresAt:null}});return;}
   const active=await tx.processingOperation.count({where:{companyId:op.companyId,kind:{in:kinds},status:'RUNNING',leaseExpiresAt:{gt:new Date()}}});
   if(active>=settings.AI_COMPANY_CONCURRENCY)return;
   const start=new Date();start.setUTCHours(0,0,0,0);
   const usage=await tx.usageRecord.aggregate({where:{companyId:op.companyId,createdAt:{gte:start}},_sum:{reservedTokens:true,reservedCost:true},_count:true});
   const reservation=this.gateway.reservation(request.task as DraftingTask,inputSchema.parse(request.input));
   const reservedTokens=reservation.tokens;
   if(Number(usage._sum.reservedCost||0)+reservation.cost>settings.AI_DAILY_COST_BUDGET_USD||usage._count>=settings.AI_DAILY_CALL_LIMIT||(usage._sum.reservedTokens||0)+reservedTokens>settings.AI_DAILY_TOKEN_BUDGET){await tx.processingOperation.update({where:{id:op.id},data:{status:'FAILED',failureCode:'AI_DAILY_BUDGET'}});return;}
   const generation=op.leaseGeneration+1,attempt=op.attemptCount+1;
   await tx.processingOperation.update({where:{id:op.id},data:{status:'RUNNING',attemptCount:attempt,leaseGeneration:generation,leaseExpiresAt:new Date(Date.now()+settings.AI_TIMEOUT_MS+15000)}});
   const usageRow=await tx.usageRecord.create({data:{companyId:op.companyId,operationId:op.id,attempt,mode:request.mode,task:request.task,model:request.model,promptVersion:request.promptVersion,schemaVersion:request.schemaVersion,reservedTokens,reservedCost:reservation.cost,...(request.mode==='mock'?{cost:0,costStatus:'MOCK'}:{})}});
   return {op,request,generation,attempt,usageId:usageRow.id};
  });
  if(!claim)return;
  const started=Date.now();let result:Awaited<ReturnType<AiGateway['execute']>>|undefined;let error:AiFailure|undefined;
  try{result=await this.gateway.execute(claim.request.task as DraftingTask,inputSchema.parse(claim.request.input),claim.op.id,claim.request.model,claim.op.failureCode==='INVALID_OUTPUT',claim.op.deadlineAt);}catch(e){error=e instanceof AiFailure?e:new AiFailure('INVALID_INPUT');}
  await this.infra.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${data.companyId}::uuid FOR UPDATE`;
   const op=await tx.processingOperation.findFirst({where:{companyId:data.companyId,id:data.operationId}});
   // Every attempt is accounted for even if its lease expired; unknown charges stay unknown.
   const settled=result||error?.usage;
   await settleAttempt(tx,data.companyId,claim.usageId,{latencyMs:Date.now()-started,outcome:error?.code||'SUCCESS',...(settled?{returnedModel:settled.model,provider:settled.provider,inputTokens:settled.inputTokens,outputTokens:settled.outputTokens,cacheReadTokens:settled.cacheReadTokens,cacheWriteTokens:settled.cacheWriteTokens,providerGenerationId:settled.providerGenerationId,usageMetadataStatus:settled.usageMetadataStatus,cost:settled.cost,costStatus:claim.request.mode==='mock'?'MOCK':settled.cost===undefined?'UNKNOWN':'ACTUAL',...(settled.cost===undefined?{}:{reservedCost:settled.cost}),...(settled.inputTokens===undefined||settled.outputTokens===undefined?{}:{reservedTokens:settled.inputTokens+settled.outputTokens})}:{})});
   if(!op||op.status!=='RUNNING'||op.leaseGeneration!==claim.generation||!op.leaseExpiresAt||op.leaseExpiresAt<=new Date())return;
   const job=await tx.job.findFirst({where:{companyId:data.companyId,id:claim.request.jobId},include:{company:true}});
   if(!job||job.revision!==claim.request.jobRevision||job.status==='ARCHIVED'||job.company.status!=='ACTIVE'||op.deadlineAt<=new Date()){await tx.processingOperation.update({where:{id:op.id},data:{status:'FAILED',failureCode:'STALE_JOB_OR_DEADLINE',leaseExpiresAt:null}});return;}
   if(error){
    const invalidCount=await tx.usageRecord.count({where:{companyId:data.companyId,operationId:op.id,outcome:'INVALID_OUTPUT'}});
    const delay=Math.max(error.retryAfterMs,1000*2**claim.attempt+Math.floor(Math.random()*500));
    const retry=error.retryable&&claim.attempt<4&&invalidCount<2&&Date.now()+delay+this.gateway.settings.AI_TIMEOUT_MS<op.deadlineAt.getTime();
    await tx.processingOperation.update({where:{id:op.id},data:{status:retry?'RETRY_WAIT':'FAILED',failureCode:error.code,leaseExpiresAt:null,availableAt:new Date(Date.now()+delay)}});return;
   }
   if(!result)return;
   const artifact=await tx.aIArtifact.create({data:{companyId:data.companyId,jobId:claim.request.jobId,operationId:op.id,task:claim.request.task,model:result.model,provider:result.provider,promptVersion:claim.request.promptVersion,schemaVersion:claim.request.schemaVersion,inputHash:claim.request.inputHash,outputHash:hashJson(result.output),output:json(result.output)}});
   if(result.output.task==='rubric-draft'){
    const latest=await tx.jobEvaluationConfig.aggregate({where:{companyId:data.companyId,jobId:job.id},_max:{version:true}});
    const config=await tx.jobEvaluationConfig.create({data:{companyId:data.companyId,jobId:job.id,version:(latest._max.version||0)+1,sourceDescription:job.description,sourceHash:hash(job.description),requirements:json(job.requirements),artifactId:artifact.id}});
    await tx.rubricCriterion.createMany({data:result.output.criteria.map((c,position)=>({...c,anchors:json(c.anchors),companyId:data.companyId,configId:config.id,position}))});
   }
   await tx.processingOperation.update({where:{id:op.id},data:{status:'SUCCEEDED',failureCode:null,leaseExpiresAt:null}});
  });
 }
}
@Injectable()
export class AiRuntime implements OnModuleInit,OnModuleDestroy {
 private queue?:Queue;private worker?:Worker;private timer?:NodeJS.Timeout;private pending?:Promise<void>;private stopping=false;
 constructor(readonly infra:Infrastructure,readonly processor:AiProcessor){}
 onModuleInit(){const connection=redisOptions(this.infra.env.REDIS_URL),prefix=`sr-${hash(new URL(this.infra.env.DATABASE_URL).pathname).slice(0,16)}`;this.queue=new Queue('ai-drafting',{prefix,connection:{...connection,commandTimeout:2000,maxRetriesPerRequest:1,enableOfflineQueue:false}});this.worker=new Worker('ai-drafting',job=>this.processor.process(job.data),{prefix,connection,concurrency:2});this.queue.on('error',()=>{});this.worker.on('error',()=>{});this.tick();}
 private tick(){if(this.stopping)return;this.pending=this.dispatch().catch(()=>{}).finally(()=>{if(!this.stopping)this.timer=setTimeout(()=>this.tick(),1000);});}
 async dispatch(){
  const due=await this.infra.prisma.outboxEvent.findMany({where:{topic:'ai-drafting',availableAt:{lte:new Date()},operation:{kind:{in:kinds},status:{in:['PENDING','RETRY_WAIT','RUNNING']},availableAt:{lte:new Date()},OR:[{leaseExpiresAt:null},{leaseExpiresAt:{lte:new Date()}}]}},orderBy:{availableAt:'asc'},take:100});
  for(const event of due){if(this.stopping)return;const leased=await this.infra.prisma.outboxEvent.updateMany({where:{id:event.id,companyId:event.companyId,availableAt:{lte:new Date()}},data:{availableAt:new Date(Date.now()+5000),leaseGeneration:{increment:1}}});if(!leased.count)continue;try{await this.queue!.add('draft',{companyId:event.companyId,operationId:event.operationId},{jobId:`ai-${event.operationId}`,attempts:1,removeOnComplete:true,removeOnFail:true});await this.infra.prisma.outboxEvent.updateMany({where:{id:event.id,companyId:event.companyId},data:{publishedAt:new Date()}});}catch{/* Reconcile published and unpublished rows independently of Redis state. */}}
 }
 isReady(){return Boolean(this.worker?.isRunning());}
 async onModuleDestroy(){this.stopping=true;clearTimeout(this.timer);await this.pending;await this.worker?.close();await this.queue?.close();}
}
