import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {digest} from './broker-policy.mjs';
const output=resolve('.verification/openrouter/broker-build');mkdirSync(output,{recursive:true,mode:0o700});
const context=mkdtempSync(join(tmpdir(),'broker-build-'));
try {
 const app=JSON.parse(readFileSync('.verification/openrouter/build/provenance.json','utf8'));
 for(const [path,hash] of Object.entries(app.sourceHashes))if(digest(readFileSync(path,'utf8'))!==hash)throw new Error();
 const files={};
 for(const file of ['broker.mjs','broker-policy.mjs','limit.mjs','ipc-transport.mjs','provider-substitute.mjs','fixture.mjs','broker-workflow.mjs','broker-client.mjs']){
  const path=`scripts/openrouter-verification/${file}`;files[file]=digest(readFileSync(path,'utf8'));copyFileSync(path,join(context,file));
 }
 const sourceDigest=digest(files),manifest={files,sourceDigest,applicationImage:app.image};
 writeFileSync(join(context,'broker-build.json'),JSON.stringify(manifest));
 writeFileSync(join(context,'Dockerfile'),`FROM ${app.image}\nUSER root\nCOPY --chown=node:node *.mjs /verification/\nCOPY --chown=node:node broker-build.json /broker-build.json\nUSER node\nCMD ["node","/verification/broker.mjs"]\n`);
 const args=['build','--label',`smartrecruit.broker.source=${sourceDigest}`,'--label',`smartrecruit.broker.application=${app.image}`,'--iidfile',`${output}/image-id`,'-t','smart-recruit-verification-broker',context];
 const result=spawnSync('docker',args,{env:{...process.env,DOCKER_BUILDKIT:'0'},encoding:'utf8',maxBuffer:20000000,timeout:300000});
 writeFileSync(`${output}/build.log`,`${result.stdout||''}\n${result.stderr||''}`,{mode:0o600});if(result.status!==0)throw new Error();
 const image=readFileSync(`${output}/image-id`,'utf8').trim();
 const inspected=JSON.parse(execFileSync('docker',['image','inspect',image],{encoding:'utf8'}))[0];
 if(inspected.Config.Labels['smartrecruit.broker.source']!==sourceDigest)throw new Error();
 const report={...manifest,image,head:app.head,applicationProvenance:app,exitCode:0,command:'node scripts/openrouter-verification/broker-build.mjs',contextFiles:[...Object.keys(files),'broker-build.json','Dockerfile']};
 writeFileSync(`${output}/provenance.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:'PASS',image,sourceDigest}));
}catch{console.error('BROKER_BUILD_FAILED');process.exitCode=1;}finally{rmSync(context,{recursive:true,force:true});}
