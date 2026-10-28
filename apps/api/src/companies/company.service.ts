import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CompanyRole, type CompanyMembership } from '../../generated/client';
import { Infrastructure } from '../common/infrastructure';
import type { Identity } from '../auth/guards';
import { lockUser, type Transaction } from '../auth/auth.service';
export type Permission = 'workspace:read' | 'team:manage' | 'settings:manage' | 'recruitment:write';
export function permitted(role: CompanyRole, permission: Permission) {
  if (permission==='workspace:read') return true;
  if (permission==='recruitment:write') return role==='COMPANY_ADMIN' || role==='RECRUITER';
  return role==='COMPANY_ADMIN';
}
export async function audit(tx:Transaction,member:CompanyMembership,action:string,entityType:string,entityId:string) {
  await tx.auditLog.create({data:{companyId:member.companyId,actorMembershipId:member.id,action,entityType,entityId,requestId:randomUUID(),summary:{}}});
}
@Injectable()
export class CompanyService {
  constructor(readonly infra:Infrastructure) {}
  async scope<T>(identity:Identity,companyId:string,permission:Permission,action:(tx:Transaction,member:CompanyMembership)=>Promise<T>) {
    return this.infra.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId}::uuid FOR UPDATE`;
      const session=await tx.refreshSession.findFirst({where:{id:identity.sessionId,userId:identity.userId,revokedAt:null,expiresAt:{gt:new Date()},user:{status:'ACTIVE'}}});
      const member=await tx.companyMembership.findUnique({where:{companyId_userId:{companyId,userId:identity.userId}},include:{company:true}});
      if (!session || !member || member.status!=='ACTIVE' || member.company.status!=='ACTIVE' || !permitted(member.role,permission)) throw new ForbiddenException('COMPANY_ACCESS_DENIED');
      return action(tx,member);
    });
  }
  list(identity:Identity,after?:string) {
    return this.infra.prisma.companyMembership.findMany({where:{userId:identity.userId,status:'ACTIVE',company:{status:'ACTIVE'}},select:{role:true,company:{select:{id:true,name:true,revision:true}}},orderBy:{companyId:'asc'},take:100,...(after?{cursor:{companyId_userId:{companyId:after,userId:identity.userId}},skip:1}:{})});
  }
  async create(identity:Identity,name:string) {
    return this.infra.prisma.$transaction(async tx=>{
      await lockUser(tx,identity.userId);
      const live=await tx.refreshSession.findFirst({where:{id:identity.sessionId,userId:identity.userId,revokedAt:null,expiresAt:{gt:new Date()},user:{status:'ACTIVE'}}});
      if (!live) throw new ForbiddenException('AUTH_REQUIRED');
      const company=await tx.company.create({data:{name:name.trim()}});
      const member=await tx.companyMembership.create({data:{companyId:company.id,userId:identity.userId,role:'COMPANY_ADMIN'}});
      await audit(tx,member,'COMPANY_CREATED','Company',company.id);
      return {id:company.id,name:company.name,revision:company.revision};
    });
  }
  get(identity:Identity,companyId:string) {
    return this.scope(identity,companyId,'workspace:read',async(tx,member)=>{
      const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{id:true,name:true,revision:true}});
      return {...company,role:member.role};
    });
  }
  settings(identity:Identity,companyId:string,name:string,revision:number) {
    return this.scope(identity,companyId,'settings:manage',async(tx,member)=>{
      const updated=await tx.company.updateMany({where:{id:companyId,revision},data:{name:name.trim(),revision:{increment:1}}});
      if (!updated.count) throw new ConflictException('STALE_REVISION');
      await audit(tx,member,'SETTINGS_CHANGED','Company',companyId);
      return {ok:true};
    });
  }
  team(identity:Identity,companyId:string,after?:string) {
    return this.scope(identity,companyId,'team:manage',tx=>tx.companyMembership.findMany({where:{companyId},select:{id:true,role:true,status:true,revision:true,user:{select:{displayName:true,normalizedEmail:true}}},orderBy:{id:'asc'},take:100,...(after?{cursor:{companyId_id:{companyId,id:after}},skip:1}:{})}));
  }
  member(identity:Identity,companyId:string,memberId:string,role:CompanyRole,status:'ACTIVE'|'INACTIVE',revision:number) {
    return this.scope(identity,companyId,'team:manage',async(tx,actor)=>{
      const member=await tx.companyMembership.findUnique({where:{companyId_id:{companyId,id:memberId}}});
      if (!member) throw new NotFoundException('MEMBER_NOT_FOUND');
      if(member.revision!==revision) throw new ConflictException('STALE_REVISION');
      if(member.role==='COMPANY_ADMIN' && member.status==='ACTIVE' && (role!=='COMPANY_ADMIN' || status!=='ACTIVE')) {
        if(await tx.companyMembership.count({where:{companyId,role:'COMPANY_ADMIN',status:'ACTIVE',user:{status:'ACTIVE'}}})<=1) throw new ConflictException('LAST_ADMIN');
      }
      await tx.companyMembership.update({where:{companyId_id:{companyId,id:memberId}},data:{role,status,revision:{increment:1}}});
      await audit(tx,actor,'MEMBERSHIP_CHANGED','CompanyMembership',memberId);
      return {ok:true};
    });
  }
}
