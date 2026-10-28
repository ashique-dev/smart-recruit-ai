import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Explicit opt-in. Creates only a uniquely named temporary database; never clears development data.
const enabled = process.env.PHASE2_DATABASE_TESTS === '1';
function psql(database, sql) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c',
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"', 'phase2-test', database], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
test.skipIf(!enabled)('Phase 2 PostgreSQL migrations, constraints, indexes and runtime privileges', () => {
  const database = `phase2_test_${randomUUID().replaceAll('-', '')}`;
  psql('postgres', `CREATE DATABASE "${database}";`);
  try {
    // Match the designated owner's default privileges in a fresh isolated database.
    psql(database, `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO smart_recruit_runtime;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO smart_recruit_runtime;`);
    const root = 'apps/api/prisma/migrations';
    for (const directory of readdirSync(root).filter(name => /^\d/.test(name)).sort()) {
      let sql = readFileSync(`${root}/${directory}/migration.sql`, 'utf8');
      // Baseline permission migration expects the Prisma metadata table.
      if (directory.includes('infrastructure_permissions')) psql(database, 'CREATE TABLE "_prisma_migrations" (id text);');
      psql(database, sql);
    }
    psql(database, readFileSync('tests/phase2/database.sql', 'utf8'));
  } finally { psql('postgres', `DROP DATABASE "${database}";`); }
}, 60000);
