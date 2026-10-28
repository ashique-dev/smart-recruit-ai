import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type RefreshSession } from '../../generated/client';
import { Infrastructure } from '../common/infrastructure';
import { Security, digest, hashPassword, normalizeEmail, token, validToken, verifyPassword } from './security';
import type { RegisterDto, LoginDto } from './dto';
import type { Identity } from './guards';
export type Transaction = Prisma.TransactionClient;
export async function lockUser(tx: Transaction, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
}
@Injectable()
export class AuthService {
  private readonly dummyHash = hashPassword(token());
  constructor(readonly infra: Infrastructure, readonly security: Security) {}
  private async newSession(tx: Transaction, userId: string, familyId: string = randomUUID(), expiresAt = new Date(Date.now()+30*86400000)) {
    const raw = token();
    const session = await tx.refreshSession.create({ data: { userId, familyId, tokenHash: digest(raw), expiresAt } });
    return { raw, session };
  }
  private async result(value: {raw: string; session: RefreshSession}) {
    return { accessToken: await this.security.access(value.session.userId, value.session.id), refreshToken: value.raw, expiresAt: value.session.expiresAt };
  }
  async register(input: RegisterDto) {
    const passwordHash = await hashPassword(input.password);
    try {
      const created = await this.infra.prisma.$transaction(async tx => {
        const user = await tx.user.create({ data: { normalizedEmail: normalizeEmail(input.email), passwordHash, displayName: input.displayName.trim() } });
        const company = await tx.company.create({ data: { name: input.companyName.trim() } });
        const membership = await tx.companyMembership.create({ data: { companyId: company.id, userId: user.id, role: 'COMPANY_ADMIN' } });
        await tx.auditLog.create({ data: { companyId: company.id, actorMembershipId: membership.id, action: 'COMPANY_CREATED', entityType: 'Company', entityId: company.id, requestId: randomUUID(), summary: {} } });
        await tx.authSecurityEvent.create({ data: { userId: user.id, kind: 'REGISTERED' } });
        return this.newSession(tx, user.id);
      });
      return this.result(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') throw new ConflictException('REGISTRATION_UNAVAILABLE');
      throw error;
    }
  }
  async login(input: LoginDto) {
    const user = await this.infra.prisma.user.findUnique({ where: { normalizedEmail: normalizeEmail(input.email) } });
    const verified = await verifyPassword(user?.passwordHash ?? await this.dummyHash, input.password);
    const created = await this.infra.prisma.$transaction(async tx => {
      if (user) await lockUser(tx,user.id);
      const current = user ? await tx.user.findUnique({ where:{id:user.id} }) : null;
      if (!verified || !current || current.status!=='ACTIVE' || current.passwordHash!==user?.passwordHash) {
        await tx.authSecurityEvent.create({ data: { userId: user?.id, kind: 'LOGIN_FAILED' } });
        return null;
      }
      await tx.authSecurityEvent.create({ data: { userId:current.id, kind:'LOGIN_SUCCEEDED' } });
      return this.newSession(tx,current.id);
    });
    if (!created) throw new UnauthorizedException('INVALID_CREDENTIALS');
    return this.result(created);
  }
  async refresh(raw: string) {
    if (!validToken(raw)) throw new UnauthorizedException('INVALID_SESSION');
    const found = await this.infra.prisma.refreshSession.findUnique({ where:{tokenHash:digest(raw)} });
    if (!found) throw new UnauthorizedException('INVALID_SESSION');
    const result = await this.infra.prisma.$transaction(async tx => {
      // User is the common lock for refresh, login, reset and family revocation.
      await lockUser(tx,found.userId);
      const current = await tx.refreshSession.findUniqueOrThrow({where:{id:found.id},include:{user:true}});
      const now = new Date();
      if (current.rotatedAt) {
        await tx.refreshSession.updateMany({where:{userId:current.userId,familyId:current.familyId,revokedAt:null},data:{revokedAt:now}});
        await tx.authSecurityEvent.create({data:{userId:current.userId,kind:'REFRESH_REPLAY'}});
        return null; // Commit revocation before returning the public error.
      }
      if (current.revokedAt || current.expiresAt<=now || current.user.status!=='ACTIVE') return null;
      const next = await this.newSession(tx,current.userId,current.familyId,current.expiresAt);
      await tx.refreshSession.update({where:{id:current.id},data:{rotatedAt:now,successorId:next.session.id}});
      return next;
    });
    if (!result) throw new UnauthorizedException('INVALID_SESSION');
    return this.result(result);
  }
  async revoke(identity: Identity, familyId?: string) {
    await this.infra.prisma.$transaction(async tx => {
      await lockUser(tx,identity.userId);
      const session = await tx.refreshSession.findFirst({where:{id:identity.sessionId,userId:identity.userId}});
      if (!session) throw new UnauthorizedException('INVALID_SESSION');
      await tx.refreshSession.updateMany({where:{userId:identity.userId,familyId:familyId ?? session.familyId,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.authSecurityEvent.create({data:{userId:identity.userId,kind:'SESSION_REVOKED'}});
    });
    return {ok:true};
  }
  async sessions(identity: Identity) {
    return this.infra.prisma.refreshSession.findMany({where:{userId:identity.userId,revokedAt:null,rotatedAt:null,expiresAt:{gt:new Date()}},select:{familyId:true,createdAt:true,expiresAt:true},take:100,orderBy:{createdAt:'desc'}});
  }
  async me(identity: Identity) {
    return this.infra.prisma.user.findUniqueOrThrow({where:{id:identity.userId},select:{id:true,normalizedEmail:true,displayName:true}});
  }
  async requestReset(email: string) {
    const user = await this.infra.prisma.user.findUnique({where:{normalizedEmail:normalizeEmail(email)}});
    if (user) await this.infra.prisma.$transaction(async tx => {
      await lockUser(tx,user.id);
      const current = await tx.user.findUniqueOrThrow({where:{id:user.id}});
      if (current.status!=='ACTIVE') return;
      const now = new Date(); const expiresAt = new Date(now.getTime()+30*60000);
      await tx.passwordResetToken.updateMany({where:{userId:user.id,consumedAt:null,revokedAt:null},data:{revokedAt:now}});
      await tx.authNotificationDelivery.updateMany({where:{userId:user.id,status:{in:['PENDING','SENDING','RETRY_WAIT']}},data:{status:'CANCELLED',ciphertext:null,keyVersion:null,leaseExpiresAt:null,leaseGeneration:{increment:1}}});
      const raw = token(); const id = randomUUID();
      const reset = await tx.passwordResetToken.create({data:{userId:user.id,tokenHash:digest(raw),expiresAt}});
      await tx.authNotificationDelivery.create({data:{id,userId:user.id,resetTokenId:reset.id,operationKey:reset.id,template:'password-reset',payloadExpiresAt:expiresAt,...this.security.encrypt(raw,`AUTH:${id}`)}});
      await tx.authOutboxEvent.create({data:{deliveryId:id,topic:'notification'}});
      await tx.authSecurityEvent.create({data:{userId:user.id,kind:'RESET_REQUESTED'}});
    });
    return {message:'If the account is eligible, a password reset email will be sent.'};
  }
  async reset(raw: string,password: string) {
    const passwordHash = await hashPassword(password);
    const reset = await this.infra.prisma.passwordResetToken.findUnique({where:{tokenHash:digest(raw)}});
    if (!reset) throw new UnauthorizedException('INVALID_RESET');
    await this.infra.prisma.$transaction(async tx => {
      await lockUser(tx,reset.userId);
      const current = await tx.passwordResetToken.findUniqueOrThrow({where:{id:reset.id},include:{user:true}});
      const now=new Date();
      if (current.consumedAt || current.revokedAt || current.expiresAt<=now || current.user.status!=='ACTIVE') throw new UnauthorizedException('INVALID_RESET');
      await tx.passwordResetToken.update({where:{id:current.id},data:{consumedAt:now}});
      await tx.passwordResetToken.updateMany({where:{userId:current.userId,id:{not:current.id},consumedAt:null,revokedAt:null},data:{revokedAt:now}});
      await tx.user.update({where:{id:current.userId},data:{passwordHash}});
      await tx.refreshSession.updateMany({where:{userId:current.userId,revokedAt:null},data:{revokedAt:now}});
      await tx.authNotificationDelivery.updateMany({where:{userId:current.userId,status:{in:['PENDING','SENDING','RETRY_WAIT']}},data:{status:'CANCELLED',ciphertext:null,keyVersion:null,leaseExpiresAt:null,leaseGeneration:{increment:1}}});
      await tx.authSecurityEvent.create({data:{userId:current.userId,kind:'PASSWORD_RESET'}});
    });
    return {ok:true};
  }
}
