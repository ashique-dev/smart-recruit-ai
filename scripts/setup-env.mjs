import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) throw new Error('.env already exists; preserve and edit it manually.');
let content = readFileSync('.env.example', 'utf8');
for (const key of ['POSTGRES_PASSWORD', 'POSTGRES_RUNTIME_PASSWORD', 'REDIS_PASSWORD', 'MINIO_ROOT_PASSWORD', 'S3_SECRET_KEY']) {
  content = content.replace(`${key}=\n`, `${key}=${randomBytes(24).toString('hex')}\n`);
}
writeFileSync('.env', content, { mode: 0o600, flag: 'wx' });
console.log('Created private local .env with random credentials. AI_PROVIDER=mock is explicit; no inference is implemented.');
