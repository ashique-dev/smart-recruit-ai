import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
const output=resolve('.verification/openrouter/build');mkdirSync(output,{recursive:true,mode:0o700});
const context=mkdtempSync(join(tmpdir(),'ga-build-context-'));
const hash=data=>createHash('sha256').update(data).digest('hex');
try {
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const files=execFileSync('git',['ls-files','-z','apps','packages'],{encoding:'utf8'}).split('\0').filter(Boolean);
 files.push('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','tsconfig.base.json','.dockerignore');
 const sourceHashes={};
 for(const path of files.sort()) {
  const contents=readFileSync(path);sourceHashes[path]=hash(contents);
  mkdirSync(dirname(join(context,path)),{recursive:true});copyFileSync(path,join(context,path));
 }
 const contextDigest=hash(JSON.stringify(sourceHashes));
 const command=['build','-f','apps/api/Dockerfile','--target','runtime','--label',`smartrecruit.verification.context=${contextDigest}`,'--label',`smartrecruit.verification.head=${head}`,'--iidfile',`${output}/image-id`,'-t','smart-recruit-openrouter-verification',context];
 const result=spawnSync('docker',command,{env:{...process.env,DOCKER_BUILDKIT:'0'},encoding:'utf8',timeout:600000,maxBuffer:20000000});
 writeFileSync(`${output}/build.log`,`${result.stdout||''}\n${result.stderr||''}`,{mode:0o600});
 const report={command:'DOCKER_BUILDKIT=0 docker build (explicit staged context; see manifest)',exitCode:result.status,head,contextDigest,sourceHashes};
 if(result.status!==0){writeFileSync(`${output}/provenance.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});throw new Error();}
 report.image=readFileSync(`${output}/image-id`,'utf8').trim();
 const image=JSON.parse(execFileSync('docker',['image','inspect',report.image],{encoding:'utf8'}))[0];
 if(image.Config.Labels['smartrecruit.verification.context']!==contextDigest||image.Config.Labels['smartrecruit.verification.head']!==head)throw new Error();
 writeFileSync(`${output}/provenance.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:'PASS',head,contextDigest,image:report.image}));
} catch {console.error('VERIFICATION_IMAGE_BUILD_FAILED');process.exitCode=1;}
finally {rmSync(context,{recursive:true,force:true});}
