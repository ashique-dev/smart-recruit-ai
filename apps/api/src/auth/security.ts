import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';

const hexKey = z.string().regex(/^[a-f0-9]{64}$/);
const config = z.object({
  AUTH_SIGNING_KEY: hexKey, AUTH_KEY_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
  CSRF_KEY: hexKey, NOTIFICATION_ENCRYPTION_KEY: hexKey,
  NOTIFICATION_KEY_VERSION: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
  SMTP_FROM: z.string().email(),
});
export function securityConfig(input: NodeJS.ProcessEnv = process.env) {
  const result = config.safeParse(input);
  if (!result.success) throw new Error('Invalid security configuration');
  const keys = [result.data.AUTH_SIGNING_KEY, result.data.CSRF_KEY, result.data.NOTIFICATION_ENCRYPTION_KEY];
  if (new Set(keys).size !== keys.length) throw new Error('Security keys must be independent');
  return result.data;
}
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const validToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const passwordOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;
export const hashPassword = (password: string) => argon2.hash(password, passwordOptions);
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
export function equal(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export class Security {
  readonly config = securityConfig();
  private readonly signingKey = Buffer.from(this.config.AUTH_SIGNING_KEY, 'hex');
  readonly issuer = 'smart-recruit-api';
  readonly audience = 'smart-recruit-staff';
  async access(userId: string, sessionId: string) {
    return new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: 'HS256', kid: this.config.AUTH_KEY_ID, typ: 'JWT' })
      .setSubject(userId).setIssuer(this.issuer).setAudience(this.audience).setIssuedAt().setExpirationTime('10m').sign(this.signingKey);
  }
  async verify(value: string) {
    const result = await jwtVerify(value, this.signingKey, { algorithms: ['HS256'], issuer: this.issuer, audience: this.audience, maxTokenAge: '10m', requiredClaims: ['sub', 'sid', 'exp', 'iat'] });
    if (result.protectedHeader.kid !== this.config.AUTH_KEY_ID || result.protectedHeader.typ !== 'JWT' || typeof result.payload.sid !== 'string' || !z.string().uuid().safeParse(result.payload.sub).success || !z.string().uuid().safeParse(result.payload.sid).success) throw new Error('INVALID_ACCESS');
    return { userId: result.payload.sub!, sessionId: result.payload.sid };
  }
  csrf() {
    const value = `${token()}.${Date.now()}`;
    return `${value}.${this.mac(value)}`;
  }
  checkCsrf(value: string) {
    const parts = value.split('.');
    if (parts.length !== 3 || !validToken(parts[0]) || !/^\d{13}$/.test(parts[1]!)) return false;
    const age = Date.now() - Number(parts[1]);
    return age >= 0 && age < 3600000 && equal(parts[2]!, this.mac(`${parts[0]}.${parts[1]}`));
  }
  mac(value: string) { return createHmac('sha256', Buffer.from(this.config.CSRF_KEY, 'hex')).update(value).digest('base64url'); }
  encrypt(value: string, context: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(this.config.NOTIFICATION_ENCRYPTION_KEY, 'hex'), iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'), keyVersion: this.config.NOTIFICATION_KEY_VERSION };
  }
  decrypt(ciphertext: string, keyVersion: string, context: string) {
    if (keyVersion !== this.config.NOTIFICATION_KEY_VERSION) throw new Error('UNKNOWN_KEY_VERSION');
    const data = Buffer.from(ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.config.NOTIFICATION_ENCRYPTION_KEY, 'hex'), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28)); decipher.setAAD(Buffer.from(context));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
}
