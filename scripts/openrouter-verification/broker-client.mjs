import {ipcRequest} from './ipc-transport.mjs';
// Test client accepts JSON on stdin, never a credential or a command to execute.
try {
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw new Error();}
 const document=JSON.parse(input);
 const results=await Promise.all((document.requests||[document]).map(r=>ipcRequest(r.envelope,r.path||'/inference').catch(()=>({status:599,body:'{"error":"IPC_UNAVAILABLE"}'}))));
 console.log(JSON.stringify(results.map(r=>({status:r.status,body:r.body}))));
}catch{console.log('{"error":"CLIENT_FAILED"}');process.exitCode=1;}
