import http from 'node:http';
export function ipcRequest(envelope,path='/inference') {
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath:'/ipc/broker.sock',method:'POST',path,agent:false,headers:{'content-type':'application/json'}},res=>{
   const chunks=[];let bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>150000){res.destroy();reject(new Error('IPC_RESPONSE_LIMIT'));}else chunks.push(chunk);});
   res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));res.on('error',()=>reject(new Error('IPC_INTERRUPTED')));
  });
  req.setTimeout(5000,()=>req.destroy());req.on('error',()=>reject(new Error('BROKER_UNAVAILABLE')));req.end(JSON.stringify(envelope));
 });
}
export async function verificationTransport(url,options) {
 if(url!=='https://openrouter.ai/api/v1/chat/completions'||options.method!=='POST'||options.redirect!=='error')throw new Error('VERIFICATION_DESTINATION_DENIED');
 const body=JSON.parse(options.body),user=JSON.parse(body.messages[1].content);
 // Deliberately discard ALL gateway headers, including its noncredential placeholder.
 const result=await ipcRequest({operationId:user.correlationId,task:body.response_format.json_schema.name.replaceAll('_','-'),body});
 return new Response(result.body,{status:result.status,headers:{'content-type':'application/json'}});
}
