import { authorizationSnapshot, subscribeAuthorization, recheckCompany } from '@/services/authorization';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { api, capturedLinkToken, clearAuth, refresh, signIn } from '@/services/api';
import type { CompanyRole, Workspace } from '@smart-recruit/shared';
const roles:CompanyRole[]=['COMPANY_ADMIN','RECRUITER','VIEWER'];
const email=z.string().trim().email().max(254);
const password=z.string().min(12,'Use at least 12 characters.').max(128);
const name=z.string().trim().min(1,'This field is required.').max(100);
interface Field {name:string;label:string;type?:string;options?:string[]}
function Form({fields,schema,submit,label,initial={}}:{fields:Field[];schema:z.ZodType<Record<string,string>>;submit:(data:Record<string,string>)=>Promise<void>;label:string;initial?:Record<string,string>}) {
 const {register,handleSubmit,setError,reset,formState:{errors,isSubmitting}}=useForm<Record<string,string>>({defaultValues:initial});
 const [error,setFailure]=useState('');const [success,setSuccess]=useState(false);
 return <form className="my-4 grid max-w-lg gap-3" onSubmit={handleSubmit(async values=>{
  setFailure('');setSuccess(false);const parsed=schema.safeParse(values);
  if(!parsed.success){for(const issue of parsed.error.issues)setError(String(issue.path[0]),{message:issue.message});return;}
  try{await submit(parsed.data);setSuccess(true);reset(initial);}catch(error){setFailure((error as Error).message);}
 })}>
  {fields.map(field=><div key={field.name}><label className="block font-medium" htmlFor={`${label}-${field.name}`}>{field.label}</label>
   {field.options?<select className="w-full rounded border p-2" id={`${label}-${field.name}`} {...register(field.name)}>{field.options.map(option=><option key={option}>{option}</option>)}</select>:<input className="w-full rounded border p-2" id={`${label}-${field.name}`} type={field.type||'text'} autoComplete={field.type==='password'?'new-password':field.name==='email'?'email':'off'} aria-invalid={Boolean(errors[field.name])} aria-describedby={`${label}-${field.name}-error`} {...register(field.name)}/>}
   {errors[field.name]&&<p id={`${label}-${field.name}-error`} role="alert">{errors[field.name]?.message}</p>}</div>)}
  <Button disabled={isSubmitting} type="submit">{isSubmitting?'Please wait…':label}</Button>
  {error&&<p role="alert">{error}</p>}{success&&<p role="status">Request completed.</p>}
 </form>;
}
export function PublicAuth({mode}:{mode:'login'|'register'|'reset-request'|'reset'|'accept'}) {
 const navigate=useNavigate();const cache=useQueryClient();const [message,setMessage]=useState('');const [existing,setExisting]=useState(false);
 const title={login:'Sign in',register:'Create your workspace','reset-request':'Request password reset',reset:'Set a new password',accept:'Accept team invitation'}[mode];
 const fields:Field[]=mode==='reset'?[{name:'password',label:'New password',type:'password'}]:mode==='accept'?existing?[]:[{name:'displayName',label:'Your name'},{name:'password',label:'Password',type:'password'}]:[{name:'email',label:'Email',type:'email'},...(mode==='reset-request'?[]:[{name:'password',label:'Password',type:'password'}]),...(mode==='register'?[{name:'displayName',label:'Your name'},{name:'companyName',label:'Company name'}]:[])];
 const schema=mode==='login'?z.object({email,password:z.string().min(1).max(128)}):mode==='register'?z.object({email,password,displayName:name,companyName:name}):mode==='reset-request'?z.object({email}):mode==='reset'?z.object({password}):existing?z.object({}):z.object({displayName:name,password});
 return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">{title}</h1>
  {(mode==='accept'||mode==='reset')&&!capturedLinkToken?<p role="alert">This link is missing its token. Open the complete link from your email.</p>:<>
  {mode==='accept'&&<><p>Existing members must sign in with the invited email. Keep this page open while signing in.</p><a href="/login" target="_blank" rel="noreferrer">Sign in in another tab</a><label className="block"><input type="checkbox" checked={existing} onChange={event=>setExisting(event.target.checked)}/> I already have an account</label></>}
  <Form key={`${mode}-${existing}`} fields={fields} schema={schema} label={title} submit={async values=>{
   if(mode==='login'||mode==='register'){await signIn(mode,values);cache.clear();navigate('/workspace');}
   else if(mode==='reset-request'){const response=await api<{message:string}>('auth/reset-request',values,undefined,false);setMessage(response.message);}
   else if(mode==='reset'){await api('auth/reset',{...values,token:capturedLinkToken},undefined,false);clearAuth();cache.clear();setMessage('Password changed. Sign in with your new password.');}
   else {if(existing)await refresh();await api(`invitations/${existing?'accept':'accept-new'}`,{...values,token:capturedLinkToken},undefined,existing);cache.clear();setMessage('Invitation accepted. You can sign in and open the workspace.');}
  }}/></>}
  {message&&<p role="status">{message}</p>}
  <nav className="flex flex-wrap gap-4"><Link to="/login">Sign in</Link><Link to="/register">Register</Link><Link to="/reset-request">Forgot password?</Link><Link to="/workspace">Workspaces</Link></nav>
 </main>;
}
interface Membership {id:string;role:CompanyRole;status:'ACTIVE'|'INACTIVE';revision:number;user:{displayName:string;normalizedEmail:string}}
interface Invitation {id:string;normalizedEmail:string;role:CompanyRole;expiresAt:string;consumedAt:string|null;revokedAt:string|null;deliveries:{status:string;failureCode:string|null}[]}
export function WorkspacePage() {
 const {companyId}=useParams();const cache=useQueryClient();const navigate=useNavigate();const [ready,setReady]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{let active=true;refresh().then(()=>{if(active)setReady(true);}).catch(()=>{if(active)setError('Sign in to open your workspace.');});return()=>{active=false;};},[]);
 const [pages,setPages]=useState({companies:'',team:'',invitations:''});
 const authorization=useSyncExternalStore(subscribeAuthorization,authorizationSnapshot);
 const sessionReady=ready&&!authorization.sessionExpired;
 const companyAllowed=Boolean(companyId)&&!authorization.deniedCompanies.has(companyId!);
 const list=useQuery({queryKey:['identity','companies',pages.companies],queryFn:({signal})=>api<{role:CompanyRole;company:Omit<Workspace,'role'>}[]>(`companies${pages.companies?'?after='+pages.companies:''}`,undefined,signal),enabled:sessionReady,retry:false});
 const company=useQuery({queryKey:[companyId,'workspace'],queryFn:({signal})=>api<Workspace>(`companies/${companyId}`,undefined,signal),enabled:sessionReady&&companyAllowed,refetchInterval:5000,retry:false});
 const admin=companyAllowed&&company.data?.role==='COMPANY_ADMIN';
 const team=useQuery({queryKey:[companyId,'team',pages.team],queryFn:({signal})=>api<Membership[]>(`companies/${companyId}/members${pages.team?'?after='+pages.team:''}`,undefined,signal),enabled:sessionReady&&admin,retry:false});
 const invitations=useQuery({queryKey:[companyId,'invitations',pages.invitations],queryFn:({signal})=>api<Invitation[]>(`companies/${companyId}/invitations${pages.invitations?'?after='+pages.invitations:''}`,undefined,signal),enabled:sessionReady&&admin,refetchInterval:5000,retry:false});
 const sessions=useQuery({queryKey:['identity','sessions'],queryFn:({signal})=>api<{familyId:string;expiresAt:string}[]>('auth/sessions',undefined,signal),enabled:sessionReady,refetchInterval:5000,retry:false});
 useEffect(()=>{
  if(company.data && company.data.role!=='COMPANY_ADMIN') {
   const predicate=(query:{queryKey:readonly unknown[]})=>query.queryKey[0]===companyId&&['team','invitations'].includes(String(query.queryKey[1]));
   void cache.cancelQueries({predicate},{revert:false});cache.removeQueries({predicate});
  }
 },[cache,companyId,company.data]);
 async function invalidate(){await cache.invalidateQueries();}
 async function action(run:()=>Promise<unknown>){setError('');try{await run();await invalidate();}catch(e){setError((e as Error).message);}}
 if(authorization.sessionExpired)return <main className="p-8"><p role="alert">Sign in to open your workspace.</p><Link to="/login">Sign in</Link></main>;
 if(!ready&&error)return <main className="p-8"><p role="alert">{error}</p><Link to="/login">Sign in</Link></main>;
 if(!ready)return <p className="p-8" role="status">Restoring your session…</p>;
 return <main className="mx-auto max-w-5xl p-8"><header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold">SmartRecruit workspace</h1><Button onClick={()=>void action(async()=>{await api('auth/logout',{});clearAuth();cache.clear();navigate('/login');})}>Sign out</Button></header>
  <p role="alert">{error||list.error?.message||company.error?.message||team.error?.message||invitations.error?.message||sessions.error?.message}</p>
  <label htmlFor="workspace">Current workspace</label><select id="workspace" className="m-3 rounded border p-2" value={companyId||''} onChange={event=>{const id=event.target.value;if(id)recheckCompany(id);void cache.cancelQueries().then(()=>{cache.clear();setPages({companies:'',team:'',invitations:''});navigate(id?`/workspace/${id}`:'/workspace');});}}><option value="">Select a workspace</option>{list.data?.map(entry=><option key={entry.company.id} value={entry.company.id}>{entry.company.name} — {entry.role}</option>)}</select>
  <div className="flex gap-3">{pages.companies&&<Button onClick={()=>setPages({...pages,companies:''})}>First workspaces</Button>}{list.data?.length===100&&<Button onClick={()=>setPages({...pages,companies:list.data!.at(-1)!.company.id})}>More workspaces</Button>}</div>
  {list.isPending&&<p role="status">Loading workspaces…</p>}
  {!companyId&&<section><h2 className="text-xl">Create another workspace</h2><Form fields={[{name:'name',label:'Workspace name'}]} schema={z.object({name})} label="Create workspace" submit={async values=>{const result=await api<{id:string}>('companies',values);await invalidate();navigate(`/workspace/${result.id}`);}}/></section>}
  {!companyAllowed&&companyId&&<p role="alert">Workspace access changed. Select a workspace to recheck your access.</p>}
  {companyAllowed&&company.data&&<section><h2 className="text-xl">{company.data.name}</h2><p>Your role: {company.data.role}</p>{!admin&&<p>Workspace access is active. Team and settings administration require a company admin.</p>}</section>}
  {admin&&<>
   <section><h2 className="mt-6 text-xl">Workspace settings</h2><Form key={`${companyId}-${company.data?.revision}`} fields={[{name:'name',label:'Company name'}]} initial={{name:company.data!.name}} schema={z.object({name})} label="Save company name" submit={async values=>{await api(`companies/${companyId}/settings`,{...values,revision:company.data!.revision});await invalidate();}}/></section>
   <section><h2 className="mt-6 text-xl">Invite a team member</h2><Form fields={[{name:'email',label:'Invite email',type:'email'},{name:'role',label:'Invitation role',options:roles}]} schema={z.object({email,role:z.enum(roles)})} initial={{role:'VIEWER'}} label="Send invitation" submit={async values=>{await api(`companies/${companyId}/invitations`,{...values,idempotencyKey:crypto.randomUUID()});await invalidate();}}/></section>
   <section><h2 className="mt-6 text-xl">Team members</h2><div className="flex gap-3">{pages.team&&<Button onClick={()=>setPages({...pages,team:''})}>First members</Button>}{team.data?.length===100&&<Button onClick={()=>setPages({...pages,team:team.data!.at(-1)!.id})}>More members</Button>}</div>{team.isPending&&<p role="status">Loading team…</p>}{team.data?.map(member=><article className="my-3 rounded border p-4" key={member.id}><h3>{member.user.displayName} — {member.user.normalizedEmail}</h3><p>{member.status}</p><Form fields={[{name:'role',label:'Member role',options:roles},{name:'status',label:'Membership status',options:['ACTIVE','INACTIVE']}]} initial={{role:member.role,status:member.status}} schema={z.object({role:z.enum(roles),status:z.enum(['ACTIVE','INACTIVE'])})} label={`Update ${member.user.displayName}`} submit={async values=>{await api(`companies/${companyId}/members/${member.id}`,{...values,revision:member.revision});await invalidate();}}/></article>)}</section>
   <section><h2 className="mt-6 text-xl">Invitations and delivery</h2><div className="flex gap-3">{pages.invitations&&<Button onClick={()=>setPages({...pages,invitations:''})}>First invitations</Button>}{invitations.data?.length===100&&<Button onClick={()=>setPages({...pages,invitations:invitations.data!.at(-1)!.id})}>More invitations</Button>}</div>{invitations.data?.length===0&&<p>No invitations yet.</p>}{invitations.data?.map(invitation=><article className="my-3 rounded border p-4" key={invitation.id}><p>{invitation.normalizedEmail} — {invitation.role}</p><p>{invitation.consumedAt?'Accepted':invitation.revokedAt?'Revoked':new Date(invitation.expiresAt)<=new Date()?'Expired':'Pending acceptance'}</p><p>Delivery: {invitation.deliveries[0]?.status||'PENDING'} {invitation.deliveries[0]?.failureCode}</p><p>SMTP acceptance does not confirm inbox receipt.</p>{!invitation.consumedAt&&!invitation.revokedAt&&<div className="flex gap-3"><Button disabled={new Date(invitation.expiresAt)<=new Date()} onClick={()=>void action(()=>api(`companies/${companyId}/invitations/${invitation.id}/resend`,{idempotencyKey:crypto.randomUUID()}))}>Resend</Button><Button onClick={()=>void action(()=>api(`companies/${companyId}/invitations/${invitation.id}/revoke`,{}))}>Revoke invitation</Button></div>}</article>)}</section>
  </>}
  <section><h2 className="mt-6 text-xl">Active sessions</h2>{sessions.data?.map(session=><div className="my-3 flex gap-4" key={session.familyId}><span>Expires {new Date(session.expiresAt).toLocaleString()}</span><Button onClick={()=>void action(()=>api(`auth/sessions/${session.familyId}/revoke`,{}))}>Revoke session</Button></div>)}</section>
 </main>;
}
export function Home(){return <Navigate to="/workspace" replace/>;}
