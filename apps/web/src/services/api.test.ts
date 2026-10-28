import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
const companyA='11111111-1111-4111-8111-111111111111';
const companyB='22222222-2222-4222-8222-222222222222';
const json=(status:number,body:unknown)=>Promise.resolve(new Response(JSON.stringify(body),{status}));
beforeEach(()=>{
 vi.resetModules();
 vi.stubGlobal('window',{location:{hash:'',pathname:'/',search:''},history:{replaceState:vi.fn()}});
 vi.stubGlobal('navigator',{});
});
afterEach(()=>vi.unstubAllGlobals());
async function modules() {
 const api=await import('./api');
 const state=await import('./authorization');
 const {bindAuthorizationCache}=await import('./authorization-cache');
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});bindAuthorizationCache(client);
 return {api,state,client};
}
for(const reason of ['expired cached CSRF','cross-tab cookie replacement']) test(`refresh renews ${reason} once`,async()=>{
 let current='first';let bootstraps=0;let refreshes=0;
 vi.stubGlobal('fetch',vi.fn((url:string,options:RequestInit)=>{
  if(url.endsWith('/csrf')) {bootstraps++;return json(200,{csrfToken:current});}
  refreshes++;
  return (options.headers as Record<string,string>)['x-csrf-token']===current?json(201,{accessToken:'access'}):json(403,{message:'CSRF_REJECTED'});
 }));
 const {api,state}=await modules();await api.refresh();current='replacement';await api.refresh();
 expect(bootstraps).toBe(2);expect(refreshes).toBe(3);expect(state.authorizationSnapshot().sessionExpired).toBe(false);
});
test('CSRF renewal rejects a still-invalid session and cannot loop',async()=>{
 let bootstrap=0;let attempts=0;
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/csrf')?json(200,{csrfToken:`csrf-${++bootstrap}`}):(++attempts===1?json(403,{message:'CSRF_REJECTED'}):json(401,{message:'INVALID_SESSION'}))));
 const {api,state}=await modules();await expect(api.refresh()).rejects.toThrow();await expect(api.refresh()).rejects.toThrow();
 expect(attempts).toBe(2);expect(bootstrap).toBe(2);expect(state.authorizationSnapshot().sessionExpired).toBe(true);
});
test('repeated CSRF rejection has exactly one renewal and no logout',async()=>{
 const fetch=vi.fn((url:string)=>url.endsWith('/csrf')?json(200,{csrfToken:'csrf'}):json(403,{message:'CSRF_REJECTED'}));vi.stubGlobal('fetch',fetch);
 const {api,state}=await modules();await expect(api.refresh()).rejects.toMatchObject({code:'CSRF_REJECTED'});
 expect(fetch).toHaveBeenCalledTimes(4);expect(state.authorizationSnapshot().sessionExpired).toBe(false);
});
test('CSRF bootstrap failure does not retry the mutation or log out',async()=>{
 let bootstrap=0;let attempts=0;
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/csrf')?json(++bootstrap===1?200:503,{csrfToken:'old'}):(attempts++,json(403,{message:'CSRF_REJECTED'}))));
 const {api,state}=await modules();await expect(api.refresh()).rejects.toThrow('Unable to establish');expect(attempts).toBe(1);expect(state.authorizationSnapshot().sessionExpired).toBe(false);
});
test('arbitrary 403 and uncertain network mutation failures are not retried',async()=>{
 const fetch=vi.fn((url:string)=>url.endsWith('/csrf')?json(200,{csrfToken:'csrf'}):json(403,{message:'OTHER_DENIAL'}));vi.stubGlobal('fetch',fetch);
 const {api}=await modules();await expect(api.api('action',{})).rejects.toMatchObject({code:'OTHER_DENIAL'});expect(fetch).toHaveBeenCalledTimes(2);
 fetch.mockRejectedValueOnce(new TypeError('Network unavailable'));
 await expect(api.api('action',{})).rejects.toThrow('Network unavailable');expect(fetch).toHaveBeenCalledTimes(3);
});
test('terminal session failure removes sensitive cache but retains public state',async()=>{
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/csrf')?json(200,{csrfToken:'csrf'}):json(401,{message:'INVALID_SESSION'})));
 const {api,state,client}=await modules();client.setQueryData([companyA,'team'],['sensitive']);client.setQueryData(['identity','sessions'],['private']);client.setQueryData(['health'],['public']);
 await expect(api.api(`companies/${companyA}/members`)).rejects.toThrow();
 expect(state.authorizationSnapshot().sessionExpired).toBe(true);expect(client.getQueryData([companyA,'team'])).toBeUndefined();expect(client.getQueryData(['identity','sessions'])).toBeUndefined();expect(client.getQueryData(['health'])).toEqual(['public']);client.clear();
});
test('company denial removes only that company and fences late successful responses',async()=>{
 let finish!:(value:Response)=>void;
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/members')?new Promise<Response>(resolve=>{finish=resolve;}):json(403,{message:'COMPANY_ACCESS_DENIED'})));
 const {api,state,client}=await modules();client.setQueryData([companyA,'team'],['old']);client.setQueryData([companyB,'team'],['other']);
 const pending=client.fetchQuery({queryKey:[companyA,'pending'],queryFn:({signal})=>api.api(`companies/${companyA}/members`,undefined,signal)});const settled=pending.catch(()=>undefined);
 await expect(api.api(`companies/${companyA}/invitations`)).rejects.toThrow();finish(new Response(JSON.stringify(['late private data']),{status:200}));await settled;
 expect(client.getQueryData([companyA,'team'])).toBeUndefined();expect(client.getQueryData([companyA,'pending'])).toBeUndefined();expect(client.getQueryData([companyB,'team'])).toEqual(['other']);expect(state.authorizationSnapshot().sessionExpired).toBe(false);client.clear();
});
test('temporary refetch failure retains authorized data and session',async()=>{
 vi.stubGlobal('fetch',vi.fn(()=>Promise.reject(new TypeError('Offline'))));
 const {api,state,client}=await modules();client.setQueryData([companyA,'team'],['authorized']);
 await expect(api.api(`companies/${companyA}/members`)).rejects.toThrow('Offline');expect(state.authorizationSnapshot().sessionExpired).toBe(false);expect(client.getQueryData([companyA,'team'])).toEqual(['authorized']);client.clear();
});
test('cancelled company-switch request cannot repopulate old data',async()=>{
 let finish!:(value:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 const {api,client}=await modules();const pending=client.fetchQuery({queryKey:[companyA,'team'],queryFn:({signal})=>api.api(`companies/${companyA}/members`,undefined,signal)});const settled=pending.catch(()=>undefined);
 await client.cancelQueries();client.clear();finish(new Response(JSON.stringify(['old company']),{status:200}));await settled;expect(client.getQueryData([companyA,'team'])).toBeUndefined();client.clear();
});
