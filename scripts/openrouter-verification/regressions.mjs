import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
const root=resolve('.verification/openrouter/regressions');mkdirSync(root,{recursive:true,mode:0o700});
const project=`ga-regression-${randomUUID()}`,password=randomBytes(24).toString('hex');
const image=JSON.parse(readFileSync('.verification/openrouter/build/provenance.json','utf8')).image;
const configPath=`${root}/compose.json`,historyPath='docs/audits/phase-3-remediation-evidence/integration.json',history=readFileSync(historyPath);
const appEnv={NODE_ENV:'test',AI_PROVIDER:'mock',OPENROUTER_API_KEY:'',DATABASE_URL:`postgresql://smart_recruit_runtime:${password}@postgres:5432/postgres?schema=public`,REDIS_URL:`redis://:${password}@redis:6379/0`,PUBLIC_APP_URL:'http://127.0.0.1:8080',CORS_ORIGIN:'http://127.0.0.1:8080',S3_ENDPOINT:'http://127.0.0.1:9',S3_REGION:'us-east-1',S3_BUCKET:'synthetic',S3_ACCESS_KEY:'synthetic',S3_SECRET_KEY:randomBytes(24).toString('hex'),SMTP_HOST:'mailpit',SMTP_PORT:'1025',SMTP_FROM:'verification@example.test',AUTH_KEY_ID:'v1',NOTIFICATION_KEY_VERSION:'v1',AUTH_SIGNING_KEY:randomBytes(32).toString('hex'),CSRF_KEY:randomBytes(32).toString('hex'),NOTIFICATION_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
const health=(test)=>({test,interval:'1s',timeout:'3s',retries:60});
const compose={services:{
 postgres:{image:'postgres:17.7-alpine',environment:{POSTGRES_USER:'verification_owner',POSTGRES_PASSWORD:password,POSTGRES_DB:'postgres',POSTGRES_RUNTIME_PASSWORD:password},volumes:[`${resolve('infrastructure/postgres/init.sh')}:/docker-entrypoint-initdb.d/01-runtime.sh:ro`],healthcheck:health(['CMD','pg_isready','-U','verification_owner','-d','postgres'])},
 redis:{image:'redis:7.4.7-alpine',environment:{REDIS_PASSWORD:password},command:['sh','-c','exec redis-server --requirepass "$REDIS_PASSWORD"'],healthcheck:health(['CMD-SHELL','REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'])},
 mailpit:{image:'axllent/mailpit:v1.27.10',healthcheck:health(['CMD','/mailpit','readyz'])},
 api:{image,environment:appEnv}},networks:{default:{internal:true}}};
writeFileSync(configPath,JSON.stringify(compose),{mode:0o600});
const env={...process.env,COMPOSE_FILE:configPath,COMPOSE_PROJECT_NAME:project,COMPOSE_DISABLE_ENV_FILE:'1',AI_PROVIDER:'mock'};
const report={project,image,internalNetwork:true,publishedPorts:false,commands:[]};
function run(command,args,extra={}) {
 const result=spawnSync(command,args,{env:{...env,...extra},encoding:'utf8',timeout:300000,maxBuffer:20000000});
 report.commands.push({command:[command,...args].join(' '),exitCode:result.status});
 writeFileSync(`${root}/command-${report.commands.length}.log`,`${result.stdout||''}\n${result.stderr||''}`,{mode:0o600});
 if(result.status!==0)throw new Error('ISOLATED_REGRESSION_FAILED');return result.stdout;
}
try {
 run('docker',['compose','up','-d','--wait','postgres','redis','mailpit']);
 const ids=run('docker',['compose','ps','-q']).trim().split(/\s+/);
 const inspected=JSON.parse(run('docker',['inspect',...ids]));
 report.containers=inspected.map(c=>({name:c.Name,image:c.Image,networks:Object.keys(c.NetworkSettings.Networks),portBindings:c.HostConfig.PortBindings}));
 if(inspected.some(c=>Object.keys(c.HostConfig.PortBindings||{}).length||Object.keys(c.NetworkSettings.Networks).some(n=>!n.startsWith(project))))throw new Error('REGRESSION_ISOLATION_FAILED');
 run('pnpm',['exec','vitest','run','tests/phase2','--reporter=json',`--outputFile=${root}/phase2.json`],{PHASE2_DATABASE_TESTS:'1',PHASE2_AUTH_TESTS:'1',PHASE2_TENANT_TESTS:'1',PHASE2_NOTIFICATION_TESTS:'1'});
 run('pnpm',['exec','vitest','run','tests/phase3','--reporter=json',`--outputFile=${root}/phase3.json`],{PHASE3_INTEGRATION:'1'});
 report.status='PASS';
 for(const suite of ['phase2','phase3']){const r=JSON.parse(readFileSync(`${root}/${suite}.json`,'utf8'));report[suite]={passed:r.numPassedTests,failed:r.numFailedTests,skipped:r.numPendingTests};}
} catch {report.status='FAIL';process.exitCode=1;}
finally {
 writeFileSync(historyPath,history);
 const cleanup=spawnSync('docker',['compose','down','--volumes','--remove-orphans'],{env,encoding:'utf8',timeout:60000});report.cleanupExit=cleanup.status;
 if(cleanup.status!==0){report.status='FAIL';process.exitCode=1;}
 unlinkSync(configPath);writeFileSync(`${root}/result.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:report.status,phase2:report.phase2,phase3:report.phase3,cleanupExit:report.cleanupExit}));
}
