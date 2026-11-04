import {spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fingerprint} from './phase3-fingerprint.mjs';
const root='docs/audits/phase-3-remediation-evidence',run=`run-${new Date().toISOString().replaceAll(':','-')}`,directory=`${root}/${run}`;
mkdirSync(directory,{recursive:true});
const evidence={startedAt:new Date().toISOString(),source:fingerprint(),images:JSON.parse(execFileSync('docker',['image','inspect','smart-recruit-ai-api','smart-recruit-ai-worker','smart-recruit-ai-web','--format','{{json .Id}}'],{encoding:'utf8'}).trim().split('\n').map(x=>JSON.parse(x)).map(x=>JSON.stringify(x)).join(',').replace(/^/,'[').replace(/$/,']')),commands:[]};
const commands=[
 ['pnpm',['install','--frozen-lockfile']],['pnpm',['lint']],['pnpm',['typecheck']],['pnpm',['build']],
 ['pnpm',['exec','vitest','run']],['pnpm',['test:phase3']],['pnpm',['test:phase2']],
 ['pnpm',['test:phase3:e2e']],['pnpm',['test:phase2:e2e']],['pnpm',['test:infrastructure']],['pnpm',['test:e2e']],
 ['docker',['compose','run','--rm','--no-deps','api','pnpm','exec','prisma','validate']],['node',['scripts/migrate.mjs','--status']],
 ['docker',['compose','config','--quiet']],['docker',['compose','-f','docker-compose.yml','-f','docker-compose.dev.yml','config','--quiet']],
 ['pnpm',['audit','--json'],1],['node',['scripts/phase3-security-check.mjs']],['git',['diff','--check']]
];
for(const [command,args,expected=0] of commands){const startedAt=new Date().toISOString(),label=`${String(evidence.commands.length+1).padStart(2,'0')}-${command}`;console.log(`RUN ${command} ${args.join(' ')}`);const r=spawnSync(command,args,{encoding:'utf8',timeout:600000,env:{...process.env,AI_PROVIDER:'mock'},maxBuffer:20000000});writeFileSync(`${directory}/${label}.log`,r.stdout+r.stderr);evidence.commands.push({command:[command,...args],startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,expectedExitCode:expected,log:`${run}/${label}.log`});writeFileSync(`${directory}/commands.json`,JSON.stringify(evidence,null,2)+'\n');console.log(`EXIT ${r.status}`);if(r.status!==expected){process.exitCode=1;break;}}
evidence.finishedAt=new Date().toISOString();evidence.finalSource=fingerprint();evidence.containers=execFileSync('docker',['compose','ps','-a','--format','{{.ID}} {{.Service}} {{.State}} {{.Health}}'],{encoding:'utf8'}).trim().split('\n');
writeFileSync(`${directory}/commands.json`,JSON.stringify(evidence,null,2)+'\n');writeFileSync(`${root}/latest.json`,JSON.stringify({run,commands:`${run}/commands.json`},null,2)+'\n');
