import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CompanyRole, Prisma, type CompanyInvitation } from '../../generated/client';
import { CompanyService, audit } from '../companies/company.service';
import { Security, digest, hashPassword, normalizeEmail, token } from '../auth/security';
import { lockUser, type Transaction } from '../auth/auth.service';
import type { Identity } from '../auth/guards';
const pending=['PENDING','SENDING','RETRY_WAIT'] as const;
@Injectable()
export class InvitationService {
 constructor(readonly companies:CompanyService,readonly security:Security) {}
 async cancel(tx:Transaction,companyId:string,invitationId:string) {
  const deliveries=await tx.notificationDelivery.findMany({where:{companyId,invitationId,status:{in:[...pending]}},select:{operationId:true}});
  await tx.notificationDelivery.updateMany({where:{companyId,invitationId,status:{in:[...pending]}},data:{status:'CANCELLED',ciphertext:null,keyVersion:null,leaseExpiresAt:null,leaseGeneration:{increment:1}}});
  await tx.processingOperation.updateMany({where:{companyId,id:{in:deliveries.map(d=>d.operationId)}},data:{status:'CANCELLED',leaseExpiresAt:null,leaseGeneration:{increment:1},failureCode:'INVITATION_INVALIDATED'}});
 }
 private async delivery(tx:Transaction,invitation:CompanyInvitation,raw:string,key:string) {
  const id=randomUUID();
  const operation=await tx.processingOperation.create({data:{companyId:invitation.companyId,kind:'TEAM_INVITATION',idempotencyKey:key,deadlineAt:invitation.expiresAt}});
  await tx.notificationDelivery.create({data:{id,companyId:invitation.companyId,operationId:operation.id,invitationId:invitation.id,generation:invitation.generation,template:'team-invitation',payloadExpiresAt:invitation.expiresAt,...this.security.encrypt(raw,`TENANT:${invitation.companyId}:${id}`)}});
  await tx.outboxEvent.create({data:{companyId:invitation.companyId,operationId:operation.id,topic:'notification'}});
  return {id:invitation.id,operationId:operation.id};
 }
 create(identity:Identity,companyId:string,email:string,role:CompanyRole,key:string) {
  return this.companies.scope(identity,companyId,'team:manage',async(tx,actor)=>{
   const prior=await tx.processingOperation.findUnique({where:{companyId_kind_idempotencyKey:{companyId,kind:'TEAM_INVITATION',idempotencyKey:key}},include:{delivery:{include:{invitation:true}}}});
   if(prior) {
    if(prior.delivery?.invitation.normalizedEmail!==normalizeEmail(email) || prior.delivery.invitation.role!==role) throw new ConflictException('IDEMPOTENCY_CONFLICT');
    return {id:prior.delivery.invitationId,operationId:prior.id};
   }
   const now=new Date();
   const old=await tx.companyInvitation.findFirst({where:{companyId,normalizedEmail:normalizeEmail(email),consumedAt:null,revokedAt:null}});
   if(old) {
    if(old.expiresAt>now) throw new ConflictException('INVITATION_EXISTS');
    await tx.companyInvitation.update({where:{companyId_id:{companyId,id:old.id}},data:{revokedAt:now}});
    await this.cancel(tx,companyId,old.id);
   }
   const existing=await tx.companyMembership.findFirst({where:{companyId,status:'ACTIVE',user:{normalizedEmail:normalizeEmail(email)}}});
   if(existing) throw new ConflictException('ALREADY_A_MEMBER');
   const raw=token();
   const invitation=await tx.companyInvitation.create({data:{companyId,normalizedEmail:normalizeEmail(email),role,issuerMembershipId:actor.id,tokenHash:digest(raw),expiresAt:new Date(now.getTime()+7*86400000)}});
   const result=await this.delivery(tx,invitation,raw,key);
   await audit(tx,actor,'TEAM_INVITED','CompanyInvitation',invitation.id);
   return result;
  });
 }
 list(identity:Identity,companyId:string,after?:string) {
  return this.companies.scope(identity,companyId,'team:manage',tx=>tx.companyInvitation.findMany({where:{companyId},select:{id:true,normalizedEmail:true,role:true,expiresAt:true,consumedAt:true,revokedAt:true,generation:true,deliveries:{select:{status:true,failureCode:true,attemptCount:true,smtpAcceptedAt:true},orderBy:{createdAt:'desc'},take:1}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100,...(after?{cursor:{companyId_id:{companyId,id:after}},skip:1}:{})}));
 }
 resend(identity:Identity,companyId:string,id:string,key:string) {
  return this.companies.scope(identity,companyId,'team:manage',async(tx,actor)=>{
   const prior=await tx.processingOperation.findUnique({where:{companyId_kind_idempotencyKey:{companyId,kind:'TEAM_INVITATION',idempotencyKey:key}},include:{delivery:true}});
   if(prior) {if(prior.delivery?.invitationId!==id) throw new ConflictException('IDEMPOTENCY_CONFLICT'); return {id,operationId:prior.id};}
   const invitation=await tx.companyInvitation.findUnique({where:{companyId_id:{companyId,id}}});
   if(!invitation) throw new NotFoundException('INVITATION_NOT_FOUND');
   if(invitation.consumedAt || invitation.revokedAt || invitation.expiresAt<=new Date()) throw new ConflictException('INVITATION_UNAVAILABLE');
   await this.cancel(tx,companyId,id);
   const raw=token();
   const updated=await tx.companyInvitation.update({where:{companyId_id:{companyId,id}},data:{tokenHash:digest(raw),generation:{increment:1},issuerMembershipId:actor.id}});
   await audit(tx,actor,'INVITATION_RESENT','CompanyInvitation',id);
   return this.delivery(tx,updated,raw,key);
  });
 }
 revoke(identity:Identity,companyId:string,id:string) {
  return this.companies.scope(identity,companyId,'team:manage',async(tx,actor)=>{
   const invitation=await tx.companyInvitation.findUnique({where:{companyId_id:{companyId,id}}});
   if(!invitation) throw new NotFoundException('INVITATION_NOT_FOUND');
   if(invitation.consumedAt) throw new ConflictException('INVITATION_CONSUMED');
   await tx.companyInvitation.update({where:{companyId_id:{companyId,id}},data:{revokedAt:new Date()}});
   await this.cancel(tx,companyId,id);
   await audit(tx,actor,'INVITATION_REVOKED','CompanyInvitation',id);
   return {ok:true};
  });
 }
 async accept(raw:string,identity?:Identity,password?:string,displayName?:string) {
  const db=this.companies.infra.prisma;
  const found=await db.companyInvitation.findUnique({where:{tokenHash:digest(raw)}});
  if(!found) throw new UnauthorizedException('INVALID_INVITATION');
  const passwordHash=!identity && password?await hashPassword(password):undefined;
  try {
   return await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${found.companyId}::uuid FOR UPDATE`;
    const invitation=await tx.companyInvitation.findUniqueOrThrow({where:{companyId_id:{companyId:found.companyId,id:found.id}},include:{company:true}});
    if(invitation.tokenHash!==digest(raw) || invitation.consumedAt || invitation.revokedAt || invitation.expiresAt<=new Date() || invitation.company.status!=='ACTIVE') throw new UnauthorizedException('INVALID_INVITATION');
    let user=await tx.user.findUnique({where:{normalizedEmail:invitation.normalizedEmail}});
    if(user) {
     if(!identity || identity.userId!==user.id) throw new UnauthorizedException('SIGN_IN_TO_ACCEPT');
     await lockUser(tx,user.id);
     const session=await tx.refreshSession.findFirst({where:{id:identity.sessionId,userId:user.id,revokedAt:null,expiresAt:{gt:new Date()},user:{status:'ACTIVE'}}});
     if(!session) throw new UnauthorizedException('AUTH_REQUIRED');
    } else {
     if(identity || !passwordHash || !displayName) throw new UnauthorizedException('CREATE_ACCOUNT_TO_ACCEPT');
     user=await tx.user.create({data:{normalizedEmail:invitation.normalizedEmail,passwordHash,displayName:displayName.trim(),verifiedAt:new Date()}});
    }
    const prior=await tx.companyMembership.findUnique({where:{companyId_userId:{companyId:invitation.companyId,userId:user.id}}});
    if(prior?.status==='ACTIVE') throw new ConflictException('ALREADY_A_MEMBER');
    const member=await tx.companyMembership.upsert({where:{companyId_userId:{companyId:invitation.companyId,userId:user.id}},create:{companyId:invitation.companyId,userId:user.id,role:invitation.role},update:{role:invitation.role,status:'ACTIVE',revision:{increment:1}}});
    await tx.companyInvitation.update({where:{companyId_id:{companyId:invitation.companyId,id:invitation.id}},data:{consumedAt:new Date()}});
    await this.cancel(tx,invitation.companyId,invitation.id);
    await audit(tx,member,'INVITATION_ACCEPTED','CompanyInvitation',invitation.id);
    return {companyId:invitation.companyId};
   });
  } catch(error) {if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') throw new ConflictException('SIGN_IN_TO_ACCEPT'); throw error;}
 }
}
