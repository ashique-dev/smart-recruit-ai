import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { Infrastructure } from '../common/infrastructure';
import { Security, digest } from '../auth/security';
import { lockUser, type Transaction } from '../auth/auth.service';
import type { DeliveryStatus, AuthNotificationDelivery, NotificationDelivery } from '../../generated/client';
const jobSchema=z.discriminatedUnion('scope',[
 z.object({scope:z.literal('AUTH'),deliveryId:z.string().uuid()}).strict(),
 z.object({scope:z.literal('TENANT'),companyId:z.string().uuid(),deliveryId:z.string().uuid(),operationId:z.string().uuid()}).strict(),
]);
export type NotificationJob=z.infer<typeof jobSchema>;
type Delivery=AuthNotificationDelivery|NotificationDelivery;
const unfinished:DeliveryStatus[]=['PENDING','SENDING','RETRY_WAIT'];
export interface Email {to:string;subject:string;text:string;messageId:string}
@Injectable()
export class Notifications {
 readonly transport;
 constructor(readonly infra:Infrastructure,readonly security:Security) {
  this.transport=nodemailer.createTransport({host:infra.env.SMTP_HOST,port:infra.env.SMTP_PORT,secure:false,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
 }
 async send(email:Email) {
  const result=await this.transport.sendMail({...email,from:this.security.config.SMTP_FROM});
  if(!result.accepted?.length) throw new Error('SMTP_NOT_ACCEPTED');
 }
 private async load(tx:Transaction,job:NotificationJob) {
  if(job.scope==='AUTH') {
   const snapshot=await tx.authNotificationDelivery.findUnique({where:{id:job.deliveryId}});
   if(!snapshot) return null;
   await lockUser(tx,snapshot.userId);
   return tx.authNotificationDelivery.findUnique({where:{id:job.deliveryId}});
  }
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${job.companyId}::uuid FOR UPDATE`;
  return tx.notificationDelivery.findFirst({where:{companyId:job.companyId,id:job.deliveryId,operationId:job.operationId}});
 }
 private async validity(tx:Transaction,job:NotificationJob,delivery:Delivery) {
  if(delivery.payloadExpiresAt<=new Date()) return {state:'EXPIRED' as const,reason:'PAYLOAD_EXPIRED'};
  if(job.scope==='AUTH' && 'resetTokenId' in delivery) {
   const reset=await tx.passwordResetToken.findUnique({where:{userId_id:{userId:delivery.userId,id:delivery.resetTokenId}},include:{user:true}});
   if(!reset || reset.consumedAt || reset.revokedAt || reset.user.status!=='ACTIVE') return {state:'CANCELLED' as const,reason:'RESET_INVALIDATED'};
   if(reset.expiresAt<=new Date()) return {state:'EXPIRED' as const,reason:'TOKEN_EXPIRED'};
   return {to:reset.user.normalizedEmail,hash:reset.tokenHash,path:'/reset',subject:'Reset your SmartRecruit password'};
  }
  if(job.scope==='TENANT' && 'invitationId' in delivery) {
   const operation=await tx.processingOperation.findUnique({where:{companyId_id:{companyId:job.companyId,id:job.operationId}}});
   if(!operation || operation.kind!=='TEAM_INVITATION' || ['CANCELLED','FAILED','SUCCEEDED'].includes(operation.status)) return {state:'CANCELLED' as const,reason:'OPERATION_INVALIDATED'};
   const invitation=await tx.companyInvitation.findUnique({where:{companyId_id:{companyId:job.companyId,id:delivery.invitationId}},include:{company:true}});
   if(!invitation || invitation.consumedAt || invitation.revokedAt || invitation.generation!==delivery.generation || invitation.company.status!=='ACTIVE') return {state:'CANCELLED' as const,reason:'INVITATION_INVALIDATED'};
   if(invitation.expiresAt<=new Date()) return {state:'EXPIRED' as const,reason:'TOKEN_EXPIRED'};
   return {to:invitation.normalizedEmail,hash:invitation.tokenHash,path:'/accept',subject:'Join a SmartRecruit workspace'};
  }
  throw new Error('INVALID_NOTIFICATION_SCOPE');
 }
 private async state(tx:Transaction,job:NotificationJob,delivery:Delivery,status:DeliveryStatus,reason:string|null=null,claim=false) {
  const terminal=!unfinished.includes(status);
  const now=new Date();
  const leaseGeneration=delivery.leaseGeneration+1;
  const attemptCount=delivery.attemptCount+(claim?1:0);
  const availableAt=status==='RETRY_WAIT'?new Date(now.getTime()+Math.min(60000,1000*2**attemptCount)):delivery.availableAt;
  const leaseExpiresAt=status==='SENDING'?new Date(now.getTime()+60000):null;
  const data={status,failureCode:reason,leaseGeneration,attemptCount,availableAt,leaseExpiresAt,
   ...(terminal?{ciphertext:null,keyVersion:null}:{}),smtpAcceptedAt:status==='SMTP_ACCEPTED'?now:null};
  if(job.scope==='AUTH') await tx.authNotificationDelivery.update({where:{id:job.deliveryId},data});
  else {
   await tx.notificationDelivery.update({where:{companyId_id:{companyId:job.companyId,id:job.deliveryId}},data});
   const operationStatus=status==='SENDING'?'RUNNING':status==='SMTP_ACCEPTED'?'SUCCEEDED':status==='EXPIRED'?'CANCELLED':status;
   await tx.processingOperation.update({where:{companyId_id:{companyId:job.companyId,id:job.operationId}},data:{status:operationStatus,attemptCount,leaseGeneration,availableAt,leaseExpiresAt,failureCode:reason}});
  }
  return {...delivery,...data};
 }
 async process(input:unknown) {
  const job=jobSchema.parse(input);
  const claimed=await this.infra.prisma.$transaction(async tx=>{
   const delivery=await this.load(tx,job);
   if(!delivery || !unfinished.includes(delivery.status)) return null;
   const validity=await this.validity(tx,job,delivery);
   if('state' in validity) {await this.state(tx,job,delivery,validity.state!,validity.reason);return null;}
   if(delivery.status==='SENDING' && delivery.leaseExpiresAt && delivery.leaseExpiresAt>new Date()) return null;
   if(delivery.availableAt>new Date()) return null;
   if(delivery.attemptCount>=5) {await this.state(tx,job,delivery,'FAILED','ATTEMPTS_EXHAUSTED');return null;}
   let raw:string;
   try {
    if(!delivery.ciphertext || !delivery.keyVersion || delivery.templateVersion!==1 || delivery.template!==(job.scope==='AUTH'?'password-reset':'team-invitation')) throw new Error('INVALID_PAYLOAD');
    raw=this.security.decrypt(delivery.ciphertext,delivery.keyVersion,job.scope==='AUTH'?`AUTH:${delivery.id}`:`TENANT:${job.companyId}:${delivery.id}`);
    if(digest(raw)!==validity.hash) throw new Error('INVALID_TOKEN_GENERATION');
   } catch {await this.state(tx,job,delivery,'FAILED','PAYLOAD_INVALID');return null;}
   const next=await this.state(tx,job,delivery,'SENDING',null,true);
   const link=`${this.infra.env.PUBLIC_APP_URL}${validity.path}#token=${raw}`;
   return {delivery:next,email:{to:validity.to!,subject:validity.subject!,text:`Open this link before it expires:\n${link}\nIf you did not expect this message, ignore it.`,messageId:`<${delivery.id}.${delivery.generation}@smart-recruit.local>`}};
  });
  if(!claimed) return;
  let failure:string|null=null; let permanent=false;
  try {await this.send(claimed.email);} catch(error) {
   failure='SMTP_UNAVAILABLE';
   const detail=error as {responseCode?:number;code?:string};
   permanent=detail.code==='EAUTH' || (detail.responseCode!==undefined && detail.responseCode>=500);
   if(permanent) failure='SMTP_REJECTED';
  }
  await this.infra.prisma.$transaction(async tx=>{
   const current=await this.load(tx,job);
   if(!current || current.status!=='SENDING' || current.leaseGeneration!==claimed.delivery.leaseGeneration || !current.leaseExpiresAt || current.leaseExpiresAt<=new Date()) return;
   const validity=await this.validity(tx,job,current);
   if('state' in validity) {await this.state(tx,job,current,validity.state!,validity.reason);return;}
   await this.state(tx,job,current,failure?(permanent || current.attemptCount>=5?'FAILED':'RETRY_WAIT'):'SMTP_ACCEPTED',failure);
  });
 }
 // Expiry has a separate candidate set: pending dispatch rows cannot occupy its batch.
 // Each terminal transition removes a row from that set, giving subsequent batches
 // forward progress. Parent locks match issuance/reset/send lock order.
 async sweepExpired():Promise<number> {
  const cutoff=new Date();
  const where={status:{in:unfinished},payloadExpiresAt:{lte:cutoff}};
  const [auth,tenant]=await Promise.all([
   this.infra.prisma.authNotificationDelivery.findMany({where,select:{id:true},orderBy:[{payloadExpiresAt:'asc'},{id:'asc'}],take:100}),
   this.infra.prisma.notificationDelivery.findMany({where,select:{id:true,companyId:true,operationId:true},orderBy:[{payloadExpiresAt:'asc'},{id:'asc'}],take:100}),
  ]);
  const jobs:NotificationJob[]=[...auth.map(row=>({scope:'AUTH' as const,deliveryId:row.id})),...tenant.map(row=>({scope:'TENANT' as const,deliveryId:row.id,companyId:row.companyId,operationId:row.operationId}))];
  let purged=0;
  for(const job of jobs) await this.infra.prisma.$transaction(async tx=>{
   const current=await this.load(tx,job);
   if(!current || !unfinished.includes(current.status) || current.payloadExpiresAt>cutoff) return;
   await this.state(tx,job,current,'EXPIRED','PAYLOAD_EXPIRED');
   purged++;
  });
  return purged;
 }
 // Runs directly from the worker timer even when Redis is unavailable.
 async reconcile():Promise<NotificationJob[]> {
  const now=new Date();
  const where={status:{in:unfinished},OR:[{availableAt:{lte:now}},{payloadExpiresAt:{lte:now}}]};
  const [auth,tenant]=await Promise.all([
   this.infra.prisma.authNotificationDelivery.findMany({where,select:{id:true},orderBy:{availableAt:'asc'},take:100}),
   this.infra.prisma.notificationDelivery.findMany({where,select:{id:true,companyId:true,operationId:true},orderBy:{availableAt:'asc'},take:100}),
  ]);
  const jobs:NotificationJob[]=[...auth.map(row=>({scope:'AUTH' as const,deliveryId:row.id})),...tenant.map(row=>({scope:'TENANT' as const,deliveryId:row.id,companyId:row.companyId,operationId:row.operationId}))];
  const ready:NotificationJob[]=[];
  for(const job of jobs) await this.infra.prisma.$transaction(async tx=>{
   const delivery=await this.load(tx,job);
   if(!delivery || !unfinished.includes(delivery.status)) return;
   const valid=await this.validity(tx,job,delivery);
   if('state' in valid) {await this.state(tx,job,delivery,valid.state!,valid.reason);return;}
   if(delivery.status==='SENDING' && delivery.leaseExpiresAt && delivery.leaseExpiresAt>now) return;
   if(delivery.attemptCount>=5) {await this.state(tx,job,delivery,'FAILED','ATTEMPTS_EXHAUSTED');return;}
   if(delivery.status==='SENDING') {await this.state(tx,job,delivery,'RETRY_WAIT','LEASE_EXPIRED');return;}
   if(delivery.availableAt<=now) ready.push(job);
  });
  return ready;
 }
 async leaseDispatch(job:NotificationJob) {
  const now=new Date(); const leaseExpiresAt=new Date(now.getTime()+10000);
  return this.infra.prisma.$transaction(async tx=>{
   // Published rows remain eligible for reconciliation after queue loss.
   const condition={topic:'notification',schemaVersion:1,availableAt:{lte:now},OR:[{leaseExpiresAt:null},{leaseExpiresAt:{lte:now}}]};
   if(job.scope==='AUTH') {
    const result=await tx.authOutboxEvent.updateMany({where:{...condition,deliveryId:job.deliveryId},data:{leaseExpiresAt,leaseGeneration:{increment:1}}}); return result.count>0;
   }
   const result=await tx.outboxEvent.updateMany({where:{...condition,companyId:job.companyId,operationId:job.operationId},data:{leaseExpiresAt,leaseGeneration:{increment:1}}}); return result.count>0;
  });
 }
 async published(job:NotificationJob) {
  if(job.scope==='AUTH') await this.infra.prisma.authOutboxEvent.updateMany({where:{deliveryId:job.deliveryId},data:{publishedAt:new Date()}});
  else await this.infra.prisma.outboxEvent.updateMany({where:{companyId:job.companyId,operationId:job.operationId},data:{publishedAt:new Date()}});
 }
}
