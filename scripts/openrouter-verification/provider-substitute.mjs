import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {syntheticResponse,responseFixture,responseAttackModes} from './fixture.mjs';
let posts=0,redirects=0,authenticated=0,receipts=[];
http.createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/stats'){res.end(JSON.stringify({posts,redirects,authenticated,receipts}));return;}
 if(req.method==='POST'&&req.url==='/reset'){posts=0;redirects=0;authenticated=0;receipts=[];res.end('{}');return;}
 if(req.url==='/redirect-target'){redirects++;res.end('{}');return;}
 if(req.method!=='POST'||req.url!=='/api/v1/chat/completions'){res.writeHead(404);res.end();return;}
 posts++;
 const key=(req.headers.authorization||'').replace(/^Bearer /,'');
 if(createHash('sha256').update(key).digest('hex')===process.env.SENTINEL_DIGEST)authenticated++;
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const body=Buffer.concat(chunks).toString('utf8');
 const mode=JSON.parse(readFileSync('/control/scenario.json','utf8')).mode;
 if(mode==='timeout'||mode==='hold')return;
 if(mode==='interrupt'){req.socket.destroy();return;}
 if(mode==='redirect'){res.writeHead(307,{location:'http://provider:8081/redirect-target'});res.end();return;}
 if(responseAttackModes.includes(mode)){res.statusCode=mode==='error-content'?500:200;res.end(responseFixture(mode,{body},key));return;}
 if(mode==='echo-secret'){res.end(JSON.stringify({error:key}));return;}
 const request=JSON.parse(body),operationId=JSON.parse(request.messages[1].content).correlationId;receipts.push({operationId,task:request.response_format.json_schema.name.replaceAll('_','-'),providerGenerationId:`gen-${operationId}`,provider:'Synthetic',model:'verification/synthetic',inputTokens:100,outputTokens:50,cacheReadTokens:0,cacheWriteTokens:5,providerReportedCost:'0.00100000'});
 res.setHeader('content-type','application/json');res.end(JSON.stringify(syntheticResponse({body})));
}).listen(8081,'0.0.0.0');
