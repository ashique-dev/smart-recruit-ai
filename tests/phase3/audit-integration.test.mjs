import {test} from 'vitest';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fingerprint} from '../../scripts/phase3-fingerprint.mjs';
function sql(database,input){const r=spawnSync('docker',['compose','exec','-T','postgres','sh','-c','exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"','phase3-audit',database],{input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
test.skipIf(process.env.PHASE3_INTEGRATION!=='1')('F01–F05 synchronized real PostgreSQL/Redis audit scenarios',()=>{
 const database=`phase3_audit_${randomUUID().replaceAll('-','')}`,container=`phase3-audit-${randomUUID()}`,source=fingerprint(),startedAt=new Date().toISOString();
 const image=execFileSync('docker',['image','inspect','smart-recruit-ai-api','--format','{{.Id}}'],{encoding:'utf8'}).trim();sql('postgres',`CREATE DATABASE "${database}";`);
 try{
 sql(database,'REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO smart_recruit_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO smart_recruit_runtime; CREATE TABLE "_prisma_migrations" (id text);');
 for(const folder of readdirSync('apps/api/prisma/migrations').filter(n=>/^\d/.test(n)).sort())sql(database,readFileSync(`apps/api/prisma/migrations/${folder}/migration.sql`,'utf8'));
 const r=spawnSync('docker',['compose','run','--rm','--name',container,'--no-deps','-e','AI_PROVIDER=mock','-e',`PHASE3_TEST_DB=${database}`,'-v',`${resolve('tests/phase3')}:/phase3:ro`,'api','node','/phase3/audit-runner.cjs'],{encoding:'utf8',timeout:180000});
 mkdirSync('docs/audits/phase-3-remediation-evidence',{recursive:true});writeFileSync('docs/audits/phase-3-remediation-evidence/integration.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),database,container,image,source,command:'PHASE3_INTEGRATION=1 pnpm exec vitest run tests/phase3/audit-integration.test.mjs',exitCode:r.status,output:r.stdout,error:r.stderr},null,2)+'\n');
 assert.equal(r.status,0,`${r.stdout}\n${r.stderr}`);assert.match(r.stdout, /"auditScenarios":/);console.log(r.stdout.trim());
 }finally{spawnSync('docker',['rm','-f',container],{stdio:'ignore'});sql('postgres',`DROP DATABASE "${database}" WITH (FORCE);`);}
},210000);
