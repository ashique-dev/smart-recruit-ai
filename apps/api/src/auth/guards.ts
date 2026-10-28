import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Infrastructure } from '../common/infrastructure';
import { Security, equal } from './security';
export interface Identity { userId: string; sessionId: string }
export interface AuthRequest extends Request { identity: Identity }
export function cookie(request: Request, name: string): string {
  const parts = (request.headers.cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${name}=`));
  return parts.length === 1 ? parts[0]!.slice(name.length + 1) : '';
}
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly infra: Infrastructure, private readonly security: Security) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET','HEAD','OPTIONS'].includes(request.method)) return true;
    const supplied = request.headers['x-csrf-token'];
    if (request.headers.origin !== this.infra.env.CORS_ORIGIN || typeof supplied !== 'string' || !equal(supplied, cookie(request, 'sr_csrf')) || !this.security.checkCsrf(supplied)) throw new ForbiddenException('CSRF_REJECTED');
    return true;
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly infra: Infrastructure, private readonly security: Security) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ') || header.length > 4096) throw new UnauthorizedException('AUTH_REQUIRED');
    let identity: Identity;
    try { identity = await this.security.verify(header.slice(7)); } catch { throw new UnauthorizedException('AUTH_REQUIRED'); }
    const session = await this.infra.prisma.refreshSession.findFirst({ where: { id: identity.sessionId, userId: identity.userId, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } } });
    if (!session) throw new UnauthorizedException('AUTH_REQUIRED');
    request.identity = identity;
    return true;
  }
}
@Injectable()
export class AuthRateGuard implements CanActivate {
  constructor(private readonly infra: Infrastructure, private readonly security: Security) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const account = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const keys = [{ key: `auth:ip:${this.security.mac(request.ip || 'unknown')}`, limit: 60 }];
    if (account) keys.push({ key: `auth:account:${this.security.mac(account)}`, limit: 10 });
    for (const { key, limit } of keys) {
      let count: unknown;
      try { count = await this.infra.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n", 1, key); }
      catch { throw new ServiceUnavailableException('AUTH_TEMPORARILY_UNAVAILABLE'); }
      if (Number(count) > limit) throw new HttpException('RATE_LIMITED',429);
    }
    return true;
  }
}
