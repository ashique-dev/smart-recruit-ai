import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
function sql(database,input) {
 const result=spawnSync('docker',['compose','exec','-T','postgres','sh','-c','exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"','phase2',database],{input,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
}
test.skipIf(process.env.PHASE2_AUTH_TESTS!=='1')('Phase 2 actual API security and PostgreSQL session races',()=>{
 const database=`phase2_auth_${randomUUID().replaceAll('-','')}`;
 sql('postgres',`CREATE DATABASE "${database}";`);
 try {
  sql(database,'REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO smart_recruit_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO smart_recruit_runtime; CREATE TABLE "_prisma_migrations" (id text);');
  for(const folder of readdirSync('apps/api/prisma/migrations').filter(n=>/^\d/.test(n)).sort()) sql(database,readFileSync(`apps/api/prisma/migrations/${folder}/migration.sql`,'utf8'));
  const result=spawnSync('docker',['compose','run','--rm','--no-deps','-e',`PHASE2_TEST_DB=${database}`,'-e',`PHASE2_TENANT_TESTS=${process.env.PHASE2_TENANT_TESTS||'0'}`,'-e',`PHASE2_NOTIFICATION_TESTS=${process.env.PHASE2_NOTIFICATION_TESTS||'0'}`,'-v',`${resolve('tests/phase2')}:/phase2:ro`,'api','node','/phase2/auth-runner.cjs'],{encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS authentication HTTP/);
  assert.match(result.stdout, /PASS F04/);
  if(process.env.PHASE2_TENANT_TESTS==='1') assert.match(result.stdout,/PASS tenant HTTP/);
  if(process.env.PHASE2_NOTIFICATION_TESTS==='1') {assert.match(result.stdout,/PASS invitations/);assert.match(result.stdout,/PASS F01/);}
  writeFileSync('/tmp/phase2-runner-evidence.txt',result.stdout,{mode:0o600});
  console.log(result.stdout.trim());
 } finally { sql('postgres',`DROP DATABASE "${database}";`); }
},150000);
