import { authorizationFence, authorizationSnapshot, beginAuthenticatedSession, denyCompany, expireSession } from './authorization';
let accessToken:string|undefined;
let csrfToken:string|undefined;
let csrfFlight:Promise<string>|undefined;
let refreshFlight:Promise<void>|undefined;
export function clearAuth() {accessToken=undefined;expireSession();}
export class ApiError extends Error {
 constructor(readonly status:number,readonly code:string,message=code) {super(message);}
}
async function csrf() {
 if(csrfToken) return csrfToken;
 if(!csrfFlight) csrfFlight=fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'}).then(async response=>{
  if(!response.ok) throw new Error('Unable to establish a secure request.');
  const body=await response.json() as {csrfToken:string};csrfToken=body.csrfToken;return csrfToken;
 }).finally(()=>{csrfFlight=undefined;});
 return csrfFlight;
}
async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
 signal?.throwIfAborted();
 const response=await fetch(`/api/v1/${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal,
  headers:{'content-type':'application/json',...(accessToken?{authorization:`Bearer ${accessToken}`} : {}),...(body!==undefined?{'x-csrf-token':await csrf()}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();
 signal?.throwIfAborted();
 if(!response.ok) {
  const message=Array.isArray(data.message)?data.message.join('. '):data.message || 'Request failed';
  throw new ApiError(response.status,typeof data.message==='string'?data.message:'REQUEST_FAILED',message);
 }
 return data as T;
}
async function csrfRequest<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
 try {return await request<T>(path,body,signal);} catch(error) {
  // This guard rejection guarantees the controller did not execute. No network,
  // generic 403, or uncertain mutation failure is retried.
  if(body===undefined || !(error instanceof ApiError) || error.status!==403 || error.code!=='CSRF_REJECTED') throw error;
  csrfToken=undefined;
  await csrf();
  return request<T>(path,body,signal); // one renewal only, including refresh
 }
}
export async function refresh() {
 if(authorizationSnapshot().sessionExpired) throw new ApiError(401,'INVALID_SESSION');
 if(!refreshFlight) {
  const fence=authorizationFence();
  const run=async()=>{
   fence();
   const result=await csrfRequest<{accessToken:string}>('auth/refresh',{});
   fence();accessToken=result.accessToken;
  };
  refreshFlight=(async()=>{
   try {if(navigator.locks) await navigator.locks.request('smart-recruit-refresh',run);else await run();}
   catch(error) {fence();if(error instanceof ApiError && error.status===401) clearAuth();throw error;}
  })().finally(()=>{refreshFlight=undefined;});
 }
 return refreshFlight;
}
export async function api<T>(path:string,body?:unknown,signal?:AbortSignal,authenticated=true):Promise<T> {
 const companyId=/^companies\/([a-f0-9-]{36})(?:[/?]|$)/i.exec(path)?.[1];
 const fence=authorizationFence(companyId);
 if(authenticated && authorizationSnapshot().sessionExpired) throw new ApiError(401,'INVALID_SESSION');
 if(companyId && authorizationSnapshot().deniedCompanies.has(companyId)) throw new ApiError(403,'COMPANY_ACCESS_DENIED');
 try {
  let result:T;
  try {result=await csrfRequest<T>(path,body,signal);} catch(error) {
   fence();
   if(!(error instanceof ApiError) || error.status!==401 || !authenticated) throw error;
   await refresh();fence();
   result=await csrfRequest<T>(path,body,signal);
  }
  fence();signal?.throwIfAborted();return result;
 } catch(error) {
  // Ignore obsolete responses, including old 401/403s after a new login/context.
  fence();
  if(error instanceof ApiError) {
   if(authenticated && error.status===401) clearAuth();
   if(companyId && error.status===403 && error.code==='COMPANY_ACCESS_DENIED') denyCompany(companyId);
  }
  throw error;
 }
}
export async function signIn(path:'login'|'register',body:unknown) {
 const result=await api<{accessToken:string}>(`auth/${path}`,body,undefined,false);
 accessToken=result.accessToken;beginAuthenticatedSession();
}
export const capturedLinkToken=(()=>{
 const value=new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
 if(window.location.hash) window.history.replaceState(null,'',window.location.pathname+window.location.search);
 return value;
})();
