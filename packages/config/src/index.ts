import { z } from 'zod';
const port = z.coerce.number().int().min(1).max(65535);
const url = (protocols: string[]) => z.string().url().refine(value => protocols.includes(new URL(value).protocol));
const origin = z.string().url().refine(value => new URL(value).origin === value, 'Expected an exact origin without path');
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: port.default(3000), WORKER_PORT: port.default(3001),
  PUBLIC_APP_URL: origin, CORS_ORIGIN: origin,
  DATABASE_URL: url(['postgres:', 'postgresql:']),
  REDIS_URL: url(['redis:', 'rediss:']).refine(value => new URL(value).password.length > 0, 'Redis authentication required'),
  S3_ENDPOINT: url(['http:', 'https:']), S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_ACCESS_KEY: z.string().min(3), S3_SECRET_KEY: z.string().min(16),
  SMTP_HOST: z.string().min(1), SMTP_PORT: port.default(1025),
  AI_PROVIDER: z.enum(['mock', 'openrouter']),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && (env.AI_PROVIDER === 'mock' || !env.PUBLIC_APP_URL.startsWith('https://') || !env.CORS_ORIGIN.startsWith('https://'))) {
    context.addIssue({ code: 'custom', message: 'Production requires HTTPS and a real provider' });
  }
});
export type Environment = z.infer<typeof environmentSchema>;
export function readEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Never include rejected values, URLs or credentials in errors.
    throw new Error(`Invalid environment: ${[...new Set(result.error.issues.map(issue => issue.path.join('.') || 'production policy'))].join(', ')}`);
  }
  return result.data;
}
