import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {lstatSync} from 'node:fs';
import {initializeCounter,consume,counterState} from './limit.mjs';

// This location is code-owned, not derived from a run name, CWD, CLI argument or environment.
export const LIVE_AUTHORIZATION_ROOT='/authorization';

// Legacy fixture utility is synthetic-only; signed credentialed admission belongs to broker.mjs.
// The approval authority provisions ONE root; run/display names are never path components.
export function authorizationBinding(value) {
  if (!value || !/^[a-f0-9-]{36}$/.test(value.authorizationId) || !/^[a-f0-9]{64}$/.test(value.approvalDigest) ||
      value.purpose!=='synthetic-authorization') throw new Error('AUTHORIZATION_INVALID');
  return JSON.stringify({authorizationId:value.authorizationId,approvalDigest:value.approvalDigest,purpose:value.purpose,limit:2});
}
export function authorizationPath(root,approval) {
  if(approval?.purpose==='live-approval' && resolve(root)!==LIVE_AUTHORIZATION_ROOT)throw new Error('LIVE_AUTHORIZATION_ROOT_FIXED');
  if(!lstatSync(root).isDirectory())throw new Error('AUTHORIZATION_ROOT_INVALID');
  return join(root,'authorization.sqlite');
}
export function provisionAuthorization(root,approval) {
  // Exclusive creation: a new identity also cannot replace an existing root's allowance.
  initializeCounter(authorizationPath(root,approval),authorizationBinding(approval));
}
export function authorizationState(root,approval) {
  return counterState(authorizationPath(root,approval),authorizationBinding(approval));
}
export function authorizedTransport(root,approval,send,denied=()=>new Error('VERIFICATION_SEND_DENIED')) {
  const binding=authorizationBinding(approval),path=authorizationPath(root,approval);
  return async(url,options)=>{
    if(url!=='https://openrouter.ai/api/v1/chat/completions'||options?.method!=='POST'||options.redirect!=='error')throw denied();
    const body=JSON.parse(options.body),task=body.response_format?.json_schema?.name?.replaceAll('_','-');
    const {correlationId}=JSON.parse(body.messages[1].content);
    try {consume(path,task,correlationId,binding);}catch{throw denied();}
    return send(url,options); // Only reachable after synchronous durable COMMIT.
  };
}

export const SYNTHETIC_APPROVAL=Object.freeze({authorizationId:'11111111-1111-4111-8111-111111111111',approvalDigest:createHash('sha256').update('Gate A synthetic authorization; never live approval').digest('hex'),purpose:'synthetic-authorization'});
