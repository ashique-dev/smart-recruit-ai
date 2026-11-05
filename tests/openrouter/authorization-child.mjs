import {provisionAuthorization,authorizedTransport,SYNTHETIC_APPROVAL} from '../../scripts/openrouter-verification/authorization.mjs';
import {randomUUID} from 'node:crypto';
const [mode,root,task]=process.argv.slice(2);
try {
  if(mode==='init')provisionAuthorization(root,SYNTHETIC_APPROVAL);
  else {
    const send=authorizedTransport(root,SYNTHETIC_APPROVAL,async()=>new Response('{}'));
    await send('https://openrouter.ai/api/v1/chat/completions',{method:'POST',redirect:'error',body:JSON.stringify({messages:[{},{content:JSON.stringify({correlationId:randomUUID()})}],response_format:{json_schema:{name:task.replaceAll('-','_')}}})});
  }
} catch {process.exitCode=2;}
