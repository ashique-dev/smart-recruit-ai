import {test} from 'vitest';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
function sql(database,input){const result=spawnSync('docker',['compose','exec','-T','postgres','sh','-c','exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"','phase3',database],{input,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
test.skipIf(process.env.PHASE3_INTEGRATION!=='1')('Phase 3 real PostgreSQL HTTP, tenant/version races and worker crash/Redis-loss recovery',()=>{
 const database=`phase3_${randomUUID().replaceAll('-','')}`;sql('postgres',`CREATE DATABASE "${database}";`);
 try{
 sql(database,'REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO smart_recruit_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO smart_recruit_runtime; CREATE TABLE "_prisma_migrations" (id text);');
 for(const folder of readdirSync('apps/api/prisma/migrations').filter(n=>/^\d/.test(n)).sort())sql(database,readFileSync(`apps/api/prisma/migrations/${folder}/migration.sql`,'utf8'));
 const result=spawnSync('docker',['compose','run','--rm','--no-deps','-e','AI_PROVIDER=mock','-e',`PHASE3_TEST_DB=${database}`,'-v',`${resolve('tests/phase3')}:/phase3:ro`,'api','node','/phase3/runner.cjs'],{encoding:'utf8',timeout:90000});assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.match(result.stdout,/PASS jobs HTTP/);assert.match(result.stdout,/PASS bounded/);writeFileSync('/tmp/phase3-integration-evidence.txt',result.stdout,{mode:0o600});console.log(result.stdout.trim());
 }finally{sql('postgres',`DROP DATABASE "${database}";`);}
},120000);
