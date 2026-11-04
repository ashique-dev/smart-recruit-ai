import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
if(!process.argv.includes('--approved-live'))throw new Error('Explicit owner approval is required before paid live calls.');
if(process.env.AI_PROVIDER!=='openrouter')throw new Error('Explicit AI_PROVIDER=openrouter required; no mock substitution.');
const load=createRequire(import.meta.url);const {AiGateway}=load('../apps/api/dist/ai-gateway/gateway');
const gateway=new AiGateway();
// Synthetic content only; no candidate information. One call per task, no retries.
const description='Build reliable TypeScript APIs.';
const analysis=await gateway.execute('job-analysis',{description,requirements:[]},randomUUID(),gateway.pin('job-analysis').model);
await gateway.execute('rubric-draft',{description,requirements:analysis.output.requirements},randomUUID(),gateway.pin('rubric-draft').model);
console.log('Both live synthetic contracts passed. No automatic application-mode change.');
