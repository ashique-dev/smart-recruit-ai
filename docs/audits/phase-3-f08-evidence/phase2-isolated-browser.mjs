import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const redisPassword=randomUUID();
const redisContainer=`f08-browser-redis-${randomUUID()}`;
const database=`phase2_browser_${randomUUID().replaceAll('-','')}`;
const override=`/tmp/${database}.yml`;
const env={...parseEnv(readFileSync('.env','utf8')),...process.env};
function run(command,args,options={}) {const result=spawnSync(command,args,{stdio:'inherit',...options});if(result.status!==0)throw new Error(`${command} failed (${result.status})`);}
function sql(db,input) {run('docker',['compose','exec','-T','postgres','sh','-c','exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"','phase2',db],{input,stdio:['pipe','inherit','inherit']});}
const connection=`postgresql://smart_recruit_runtime:${encodeURIComponent(env.POSTGRES_RUNTIME_PASSWORD)}@postgres:5432/${database}?schema=public`;
writeFileSync(override,`services:\n  api:\n    environment:\n      DATABASE_URL: \${PHASE2_DATABASE_URL:?}\n      REDIS_URL: redis://:${redisPassword}@${redisContainer}:6379/0\n  worker:\n    environment:\n      DATABASE_URL: \${PHASE2_DATABASE_URL:?}\n      REDIS_URL: redis://:${redisPassword}@${redisContainer}:6379/0\n`,{mode:0o600});
const testEnv={...process.env,PHASE2_DATABASE_URL:connection,PHASE2_E2E:'1'};
const args=['compose','-f','docker-compose.yml','-f',override];
console.log(JSON.stringify({database,redisContainer,redisImage:'redis:7.4.7-alpine'}));
run('docker',['run','-d','--rm','--name',redisContainer,'--network','smart-recruit-ai_data','-e','F08_REDIS_PASSWORD','redis:7.4.7-alpine','sh','-c','exec redis-server --requirepass "$F08_REDIS_PASSWORD" --save "" --appendonly no'],{env:{...process.env,F08_REDIS_PASSWORD:redisPassword}});
sql('postgres',`CREATE DATABASE "${database}";`);
try {
 sql(database,'REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO smart_recruit_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO smart_recruit_runtime; CREATE TABLE "_prisma_migrations" (id text);');
 for(const folder of readdirSync('apps/api/prisma/migrations').filter(n=>/^\d/.test(n)).sort())sql(database,readFileSync(`apps/api/prisma/migrations/${folder}/migration.sql`,'utf8'));
 run('docker',[...args,'up','-d','--no-deps','--wait','api','worker','web'],{env:testEnv});
 run('docker',[...args,'up','-d','--no-deps','--force-recreate','--wait','nginx'],{env:testEnv});
 run('pnpm',['exec','playwright','test','tests/e2e/phase2.spec.ts'],{env:testEnv});
} finally {
 run('docker',['compose','up','-d','--no-deps','--wait','api','worker','web']);
 run('docker',['compose','up','-d','--no-deps','--force-recreate','--wait','nginx']);
 run('docker',['rm','-f',redisContainer]);
 sql('postgres',`DROP DATABASE "${database}";`);unlinkSync(override);
}
