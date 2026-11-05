import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomBytes, randomUUID} from 'node:crypto';
import {provisionAuthorization,authorizationState,SYNTHETIC_APPROVAL} from './authorization.mjs';
const mode = process.argv[2], runName = process.argv[3];
if (!['--provision-synthetic-authorization','--synthetic','--synthetic-proof'].includes(mode) || process.argv.length > 4 ||
    (runName !== undefined && !/^[a-z0-9-]{1,64}$/.test(runName))) throw new Error('ONLY_EXPLICIT_SYNTHETIC_MODE_SUPPORTED');
if(mode==='--synthetic-proof'&&runName!==undefined)throw new Error('PROOF_FIXTURE_HAS_NO_RUN_NAME');
// A proof is a new synthetic authorization fixture, never a live authorization or reset.
const proofId=mode==='--synthetic-proof'?randomUUID():null;
const root = resolve('.verification/openrouter', ...(proofId?['proofs',proofId]:runName ? ['runs',runName] : []));
// Authorization capacity is independent of runName. This is not the future LIVE root.
const authorizationRoot=proofId?`${root}/authorization`:resolve('.verification/openrouter/authorization-v2-synthetic');
const approval=proofId?{...SYNTHETIC_APPROVAL,authorizationId:proofId,approvalDigest:createHash('sha256').update(`synthetic proof ${proofId}`).digest('hex')}:SYNTHETIC_APPROVAL;
mkdirSync(root,{recursive:true,mode:0o700});
if(proofId){mkdirSync(authorizationRoot,{mode:0o700});provisionAuthorization(authorizationRoot,approval);}
if (mode === '--provision-synthetic-authorization') {
  if(runName!==undefined)throw new Error('AUTHORIZATION_HAS_NO_RUN_NAME');
  mkdirSync(authorizationRoot,{recursive:true,mode:0o700});
  provisionAuthorization(authorizationRoot,SYNTHETIC_APPROVAL);
  console.log('Initialized synthetic-only counter; no reset command exists.');
} else {
  if (!existsSync(authorizationRoot)) throw new Error('PROVISION_AUTHORIZATION_SEPARATELY');
  if(authorizationState(authorizationRoot,approval).consumed!==0)throw new Error('VERIFICATION_RUN_ALREADY_CONSUMED');
  const id = `orverify-${randomUUID()}`, network = `${id}-net`, postgres = `${id}-pg`, redis = `${id}-redis`, runner = `${id}-runner`;
  const password = randomBytes(24).toString('hex');
  // No normal .env, inherited DATABASE_URL, or application credentials are read.
  const env = {NODE_ENV:'test',VERIFICATION_MODE:'synthetic',VERIFICATION_AUTHORIZATION:JSON.stringify(approval),AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'synthetic-not-a-credential',
    DATABASE_URL:`postgresql://smart_recruit_runtime:${password}@${postgres}:5432/openrouter_verification?schema=public`,
    REDIS_URL:`redis://:${password}@${redis}:6379/0`,PUBLIC_APP_URL:'http://127.0.0.1:8080',CORS_ORIGIN:'http://127.0.0.1:8080',
    S3_ENDPOINT:'http://127.0.0.1:9',S3_REGION:'us-east-1',S3_BUCKET:'synthetic',S3_ACCESS_KEY:'synthetic',S3_SECRET_KEY:randomBytes(24).toString('hex'),
    SMTP_HOST:'127.0.0.1',SMTP_PORT:'9',SMTP_FROM:'verification@example.test',AUTH_KEY_ID:'v1',NOTIFICATION_KEY_VERSION:'v1',
    AUTH_SIGNING_KEY:randomBytes(32).toString('hex'),CSRF_KEY:randomBytes(32).toString('hex'),NOTIFICATION_ENCRYPTION_KEY:randomBytes(32).toString('hex'),
    AI_MODEL_JOB_ANALYSIS:'verification/synthetic',AI_MODEL_RUBRIC_DRAFT:'verification/synthetic',AI_TIMEOUT_MS:'1000',AI_COMPANY_CONCURRENCY:'1',
    AI_ROUTE_MANIFEST:JSON.stringify(Object.fromEntries(['job-analysis','rubric-draft'].map(t=>[t,{model:'verification/synthetic',provider:'Synthetic',contextTokens:32768,maxOutputTokens:4096,inputCostPerMillion:1,outputCostPerMillion:2,structuredOutputs:true,zdr:true,verifiedAt:new Date().toISOString()}])))};
  function docker(args,input) {
    const result = spawnSync('docker',args,{input,encoding:'utf8',timeout:240000,maxBuffer:10000000});
    if (result.status !== 0) {
      if (args.includes('/verification/workflow.mjs')) {
        try {
          const failure = JSON.parse(result.stdout.trim().split('\n').at(-1));
          if (/^[a-z-]+$/.test(failure.stage)) console.error(`Workflow failed at stage: ${failure.stage}`);
        } catch { /* Never echo raw child output. */ }
      }
      throw new Error(`VERIFICATION_DOCKER_STEP_FAILED_${args[0]}`);
    }
    return result.stdout;
  }
  try {
    const provenance=JSON.parse(readFileSync('.verification/openrouter/build/provenance.json','utf8'));
    for(const [path,expected] of Object.entries(provenance.sourceHashes))if(createHash('sha256').update(readFileSync(path)).digest('hex')!==expected)throw new Error('BUILD_SOURCE_CHANGED');
    const currentHead=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
    if(currentHead!==provenance.head||provenance.exitCode!==0)throw new Error('BUILD_HEAD_CHANGED');
    const image = provenance.image;
    const imageInfo=JSON.parse(docker(['image','inspect',image]))[0];
    if(imageInfo.Config.Labels['smartrecruit.verification.context']!==provenance.contextDigest||imageInfo.Config.Labels['smartrecruit.verification.head']!==provenance.head)throw new Error('IMAGE_PROVENANCE_MISMATCH');
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('VERIFICATION_IMAGE_REQUIRED');
    docker(['network','create','--internal',network]);
    const networkInfo = JSON.parse(docker(['network','inspect',network]))[0];
    if (!networkInfo.Internal) throw new Error('VERIFICATION_INTERNAL_NETWORK_REQUIRED');
    docker(['run','-d','--name',postgres,'--network',network,'--env','POSTGRES_DB=openrouter_verification','--env','POSTGRES_USER=verification_owner','--env',`POSTGRES_PASSWORD=${password}`,'postgres:17.7-alpine']);
    docker(['run','-d','--name',redis,'--network',network,'redis:7.4.7-alpine','redis-server','--requirepass',password]);
    let ready = false;
    for (let n=0;n<60;n++) {
      if (spawnSync('docker',['exec',postgres,'pg_isready','-h','127.0.0.1','-U','verification_owner','-d','openrouter_verification'],{stdio:'ignore'}).status === 0) { ready=true;break; }
      await new Promise(r=>setTimeout(r,500));
    }
    if (!ready) throw new Error('VERIFICATION_DATABASE_NOT_READY');
    const sql = text => docker(['exec','-i',postgres,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','verification_owner','-d','openrouter_verification'],text);
    sql(`CREATE ROLE smart_recruit_runtime LOGIN PASSWORD '${password}'; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO smart_recruit_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO smart_recruit_runtime; CREATE TABLE "_prisma_migrations" (id text);`);
    for (const folder of readdirSync('apps/api/prisma/migrations').filter(n=>/^\d/.test(n)).sort()) sql(readFileSync(`apps/api/prisma/migrations/${folder}/migration.sql`,'utf8'));
    const codeRoot=`${root}/code`;mkdirSync(codeRoot,{mode:0o700});
    const verificationSourceHashes={};
    for(const file of readdirSync('scripts/openrouter-verification').filter(n=>n.endsWith('.mjs')).sort()){
      const source=`scripts/openrouter-verification/${file}`;verificationSourceHashes[source]=createHash('sha256').update(readFileSync(source)).digest('hex');copyFileSync(source,`${codeRoot}/${file}`);
    }
    const environment = Object.entries(env).flatMap(([k,v])=>['--env',`${k}=${v}`]);
    // Standalone image; no Compose service/network/environment or Docker socket is mounted.
    const output = docker(['run','--name',runner,'--network',network,'--user',`${process.getuid()}:${process.getgid()}`,
      ...environment,'--mount',`type=bind,src=${codeRoot},dst=/verification,readonly`,
      '--mount',`type=bind,src=${root},dst=/evidence`,'--mount',`type=bind,src=${authorizationRoot},dst=/authorization`,image,'node','/verification/workflow.mjs']);
    const evidence = JSON.parse(output.trim().split('\n').at(-1));
    if (evidence.status !== 'PASS' || evidence.mode !== 'synthetic') throw new Error('VERIFICATION_EVIDENCE_INVALID');
    const inspected=JSON.parse(docker(['inspect',runner,postgres,redis]));
    const isolation=inspected.map(c=>({name:c.Name,image:c.Image,networks:Object.keys(c.NetworkSettings.Networks),portBindings:c.HostConfig.PortBindings,mounts:c.Mounts.map(m=>({type:m.Type,destination:m.Destination,rw:m.RW}))}));
    if(inspected[0].Image!==image||inspected.some(c=>Object.keys(c.NetworkSettings.Networks).length!==1||!c.NetworkSettings.Networks[network]||Object.keys(c.HostConfig.PortBindings||{}).length!==0))throw new Error('CONTAINER_ISOLATION_FAILED');
    evidence.authorization=approval; evidence.verificationSourceHashes=verificationSourceHashes; evidence.image=image; evidence.provenance=provenance; evidence.isolation={internalNetwork:networkInfo.Internal,containers:isolation,disposableDatabase:true};
    writeFileSync(`${root}/result.json`,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({status:'PASS',mode:'synthetic',evidence:`${root}/result.json`,checks:evidence.checks}));
  } catch (error) {
    if(/^(VERIFICATION_|BUILD_|IMAGE_|CONTAINER_)[A-Za-z_]+$/.test(error.message))console.error(error.message);
    console.error('GATE_A_SYNTHETIC_WORKFLOW_FAILED; counter retained; no raw process errors emitted.');
    process.exitCode=1;
  } finally {
    for (const name of [runner,postgres,redis]) spawnSync('docker',['rm','-f','-v',name],{stdio:'ignore'});
    spawnSync('docker',['network','rm',network],{stdio:'ignore'});
  }
}
