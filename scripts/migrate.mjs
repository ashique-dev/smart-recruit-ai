import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
if (!env.POSTGRES_PASSWORD) throw new Error('POSTGRES_PASSWORD required');
const database = env.POSTGRES_DB || 'smart_recruit';
const user = env.POSTGRES_USER || 'smart_recruit_owner';
const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@postgres:5432/${encodeURIComponent(database)}?schema=public`;
// Only this ephemeral process receives the schema owner credential.
const result = spawnSync('docker', ['compose', 'run', '--rm', '--no-deps', '-e', 'DATABASE_URL', 'api', 'pnpm', 'prisma:migrate:deploy'], {
  stdio: 'inherit', env: { ...process.env, DATABASE_URL: url },
});
process.exit(result.status ?? 1);
