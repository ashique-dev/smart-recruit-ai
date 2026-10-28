export type AuthorizationEvent = {kind:'session'} | {kind:'company';companyId:string};
let epoch=0;
const companyEpochs=new Map<string,number>();
let snapshot={sessionExpired:false,deniedCompanies:new Set<string>()};
const listeners=new Set<()=>void>();
const handlers=new Set<(event:AuthorizationEvent)=>void>();
export const authorizationSnapshot=()=>snapshot;
export function subscribeAuthorization(listener:()=>void) {listeners.add(listener);return ()=>{listeners.delete(listener);};}
export function onAuthorizationFailure(handler:(event:AuthorizationEvent)=>void) {handlers.add(handler);return ()=>{handlers.delete(handler);};}
function notify() {for(const listener of listeners) listener();}
export function expireSession() {
 epoch++;
 snapshot={sessionExpired:true,deniedCompanies:new Set()};
 for(const handler of handlers) handler({kind:'session'});
 notify();
}
export function denyCompany(companyId:string) {
 companyEpochs.set(companyId,(companyEpochs.get(companyId)||0)+1);
 snapshot={...snapshot,deniedCompanies:new Set([...snapshot.deniedCompanies,companyId])};
 for(const handler of handlers) handler({kind:'company',companyId});
 notify();
}
export function beginAuthenticatedSession() {epoch++;snapshot={sessionExpired:false,deniedCompanies:new Set()};notify();}
export function recheckCompany(companyId:string) {
 // Only an explicit workspace selection may retry a previously denied context.
 companyEpochs.set(companyId,(companyEpochs.get(companyId)||0)+1);
 const deniedCompanies=new Set(snapshot.deniedCompanies);deniedCompanies.delete(companyId);
 snapshot={...snapshot,deniedCompanies};notify();
}
export function authorizationFence(companyId?:string) {
 const startedEpoch=epoch;const companyEpoch=companyId?companyEpochs.get(companyId):undefined;
 return ()=>{
  if(startedEpoch!==epoch || (companyId && companyEpoch!==companyEpochs.get(companyId))) throw new DOMException('Authorization context changed','AbortError');
 };
}
