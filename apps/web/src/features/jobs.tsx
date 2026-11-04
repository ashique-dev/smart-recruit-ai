import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError } from '@/services/api';
import { Button } from '@/components/ui/button';
interface Requirement {key:string;text:string;quote:string;start:number;end:number}
interface Criterion {key:string;label:string;description:string;weight:number;anchors:string[];evidenceRequirements:string;requirementKeys:string[]}
interface Config {id:string;version:number;revision:number;status:string;sourceHash:string;criteria:Criterion[]}
interface Job {id:string;title:string;description:string;department:string;employmentType:string;workArrangement:string;location:string;requirements:Requirement[];revision:number;status:string}
interface Detail extends Job {configs:Config[];requests:{operationId:string;task:'job-analysis'|'rubric-draft';mode:string;model:string;jobRevision:number;operation:{status:string;failureCode:string|null;attemptCount:number}}[];artifacts:{id:string;operationId:string;output:{task:string;requirements?:Requirement[];ambiguities?:string[];missingInformation?:string[]}}[]}
const jobSchema=z.object({title:z.string().trim().min(1).max(200),description:z.string().trim().min(1).max(20000),department:z.string().max(120),employmentType:z.enum(['FULL_TIME','PART_TIME','CONTRACT','TEMPORARY','INTERNSHIP','OTHER']),workArrangement:z.enum(['ONSITE','HYBRID','REMOTE']),location:z.string().max(200)});
type JobFields=z.infer<typeof jobSchema>;
const initial:JobFields={title:'',description:'',department:'',employmentType:'FULL_TIME',workArrangement:'REMOTE',location:''};
function JobForm({job,save}:{job?:Job;save:(data:JobFields)=>Promise<void>}){
 const {register,handleSubmit,formState:{isSubmitting}}=useForm<JobFields>({defaultValues:job?jobSchema.parse(job):initial});const [error,setError]=useState('');
 return <form className="my-4 grid gap-3" onSubmit={handleSubmit(async values=>{setError('');const parsed=jobSchema.safeParse(values);if(!parsed.success){setError(parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));return;}try{await save(parsed.data);}catch(e){setError((e as Error).message);}})}>
 {(['title','description','department','location'] as const).map(field=><label key={field} className="grid gap-1">{field==='description'?'Job description':field[0]!.toUpperCase()+field.slice(1)}{field==='description'?<textarea className="rounded border p-2" rows={5} {...register(field)}/>:<input className="rounded border p-2" {...register(field)}/>}</label>)}
 <label>Employment type<select className="m-2 rounded border p-2" {...register('employmentType')}>{jobSchema.shape.employmentType.options.map(v=><option key={v}>{v}</option>)}</select></label>
 <label>Work arrangement<select className="m-2 rounded border p-2" {...register('workArrangement')}>{jobSchema.shape.workArrangement.options.map(v=><option key={v}>{v}</option>)}</select></label>
 <Button disabled={isSubmitting} type="submit">{job?'Save job':'Create job'}</Button>{error&&<p role="alert">{error}</p>}
 </form>;
}
const transitions:Record<string,string[]>={DRAFT:['ACTIVE','ARCHIVED'],ACTIVE:['PAUSED','CLOSED'],PAUSED:['ACTIVE','CLOSED'],CLOSED:['ARCHIVED'],ARCHIVED:[]};
const cleanCriterion=(c:Criterion):Criterion=>({key:c.key,label:c.label,description:c.description,weight:c.weight,anchors:c.anchors,evidenceRequirements:c.evidenceRequirements,requirementKeys:c.requirementKeys});
function RubricEditor({job,config,save,reload}:{job:Job;config?:Config;reload:()=>Promise<void>;save:(criteria:Criterion[],existing:boolean)=>Promise<void>}){
 const [criteria,setCriteria]=useState<Criterion[]>(config?config.criteria.map(cleanCriterion):[{key:'criterion_1',label:'',description:'',weight:10000,anchors:['No evidence','Limited','Partial','Meets','Exceeds'],evidenceRequirements:'',requirementKeys:job.requirements[0]?[job.requirements[0].key]:[]}]);
 const [error,setError]=useState(''),[pending,setPending]=useState(false),[conflict,setConflict]=useState(false);
 const update=(index:number,patch:Partial<Criterion>)=>setCriteria(criteria.map((c,i)=>i===index?{...c,...patch}:c));
 return <form className="my-4 grid gap-3" onSubmit={async e=>{e.preventDefault();setPending(true);setError('');try{await save(criteria,config?.status==='DRAFT');}catch(e){if(e instanceof ApiError&&e.status===409){setConflict(true);setError('Editing conflict: this job or rubric changed. Your unsaved edits are preserved. Review them before discarding and reloading the latest version.');}else setError((e as Error).message);}finally{setPending(false);}}}>
 <p>Editing job revision {job.revision}{config?`, rubric revision ${config.revision}`:''}.</p>
 <p>Weights use basis points: 10,000 = 100%. Total: {criteria.reduce((n,c)=>n+c.weight,0)}. Five anchors describe ratings 0–4. Approval requires a total of 10,000.</p>
 {criteria.map((c,i)=><fieldset className="grid gap-2 rounded border p-3" key={i}><legend>Criterion {i+1}</legend>
 {(['key','label','description','evidenceRequirements'] as const).map(field=><label key={field} className="grid">{field}<input required maxLength={field==='key'?60:2000} className="rounded border p-2" value={c[field]} onChange={e=>update(i,{[field]:e.target.value})}/></label>)}
 <label>Weight (basis points)<input className="m-2 rounded border p-2" type="number" min={0} max={10000} step={1} value={c.weight} onChange={e=>update(i,{weight:Number(e.target.value)})}/></label>
 {c.anchors.map((anchor,rating)=><label className="grid" key={rating}>Rating {rating} anchor<input required className="rounded border p-2" value={anchor} onChange={e=>update(i,{anchors:c.anchors.map((a,r)=>r===rating?e.target.value:a)})}/></label>)}
 <p>Grounded requirements</p>{job.requirements.map(r=><label key={r.key}><input type="checkbox" checked={c.requirementKeys.includes(r.key)} onChange={e=>update(i,{requirementKeys:e.target.checked?[...c.requirementKeys,r.key]:c.requirementKeys.filter(k=>k!==r.key)})}/> {r.text}</label>)}
 <Button type="button" disabled={criteria.length===1} onClick={()=>setCriteria(criteria.filter((_,n)=>n!==i))}>Remove criterion</Button></fieldset>)}
 <Button type="button" disabled={criteria.length>=30} onClick={()=>setCriteria([...criteria,{key:`criterion_${crypto.randomUUID().slice(0,8)}`,label:'',description:'',weight:0,anchors:['','','','',''],evidenceRequirements:'',requirementKeys:[]}])}>Add criterion</Button>
 <Button type="submit" disabled={pending||conflict}>{config?.status==='DRAFT'?'Save rubric draft':'Save as new rubric version'}</Button>{error&&<p role="alert">{error}</p>}{conflict&&<Button type="button" disabled={pending} onClick={async()=>{setPending(true);try{await reload();}catch(e){setError((e as Error).message);}finally{setPending(false);}}}>Discard unsaved edits and reload latest rubric</Button>}
 </form>;
}
function RequirementsEditor({job,save}:{job:Job;save:(requirements:Requirement[])=>Promise<void>}){
 const [rows,setRows]=useState(job.requirements),[error,setError]=useState(''),[pending,setPending]=useState(false);
 return <form className="grid gap-3" onSubmit={async e=>{e.preventDefault();setError('');setPending(true);try{const result=rows.map(r=>{const start=job.description.indexOf(r.quote);if(start<0||!r.quote)throw new Error('Each quote must occur exactly in the job description.');return {...r,start,end:start+r.quote.length};});await save(result);}catch(e){setError((e as Error).message);}finally{setPending(false);}}}>
 {rows.map((r,i)=><fieldset className="grid gap-2 border p-3" key={r.key}><legend>{r.key}</legend><label>Requirement<input className="w-full border p-2" required value={r.text} onChange={e=>setRows(rows.map((v,n)=>n===i?{...v,text:e.target.value}:v))}/></label><label>Exact supporting quote<textarea className="w-full border p-2" required value={r.quote} onChange={e=>setRows(rows.map((v,n)=>n===i?{...v,quote:e.target.value}:v))}/></label><Button type="button" onClick={()=>setRows(rows.filter((_,n)=>n!==i))}>Remove requirement</Button></fieldset>)}
 <Button type="button" disabled={rows.length>=30} onClick={()=>setRows([...rows,{key:`req_${crypto.randomUUID().slice(0,8)}`,text:'',quote:'',start:0,end:0}])}>Add requirement</Button><Button disabled={pending} type="submit">Save reviewed requirements</Button>{error&&<p role="alert">{error}</p>}
 </form>;
}
export function Jobs({companyId,canWrite}:{companyId:string;canWrite:boolean}){
 const cache=useQueryClient();const [selected,setSelected]=useState(''),[after,setAfter]=useState(''),[create,setCreate]=useState(false),[editor,setEditor]=useState<{session:string;job:Job;config?:Config}|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const [before,setBefore]=useState<number|undefined>();
 const approvalKeys=useRef(new Map<string,string>());
 const base=`companies/${companyId}/jobs`;
 const list=useQuery({queryKey:[companyId,'jobs',after],queryFn:({signal})=>api<Job[]>(`${base}${after?'?after='+after:''}`,undefined,signal),retry:false});
 const detail=useQuery({queryKey:[companyId,'job',selected],queryFn:({signal})=>api<Detail>(`${base}/${selected}`,undefined,signal),enabled:Boolean(selected),refetchInterval:2000,retry:false});
 const history=useQuery({queryKey:[companyId,'job',selected,'rubrics',before],queryFn:({signal})=>api<{items:Config[];nextBefore:number|null}>(`${base}/${selected}/rubrics${before?`?before=${before}`:''}`,undefined,signal),enabled:Boolean(selected),refetchInterval:2000,retry:false});
 const job=detail.data;
 const configs=history.data?.items||[];
 function openEditor(job:Job,config?:Config){setEditor({session:crypto.randomUUID(),job:structuredClone(job),config:config?structuredClone(config):undefined});}
 async function approve(config:Config){const identity=`${selected}:${config.id}:${config.revision}`;let key=approvalKeys.current.get(identity);if(!key){key=crypto.randomUUID();approvalKeys.current.set(identity,key);}await api(`${base}/${selected}/rubrics/${config.id}/approve`,{revision:config.revision,idempotencyKey:key});}

 async function invalidate(){await cache.invalidateQueries({queryKey:[companyId,'jobs']});await cache.invalidateQueries({queryKey:[companyId,'job']});}
 async function action(run:()=>Promise<unknown>){setPending(true);setError('');try{await run();await invalidate();}catch(e){setError((e as Error).message);}finally{setPending(false);}}
 async function saveRequirements(requirements:Requirement[]){if(!job)return;const {title,description,department,employmentType,workArrangement,location,revision}=job;await api(`${base}/${job.id}`,{title,description,department,employmentType,workArrangement,location,revision,requirements});await invalidate();}
 const writable=canWrite&&job?.status!=='ARCHIVED';
 const ownership=useRef<{selected:string;session?:string;writable:boolean}|null>(null);
 ownership.current={selected,session:editor?.session,writable};
 useEffect(()=>()=>{ownership.current=null;},[]);
 useEffect(()=>{if(!writable)setEditor(null);},[writable]);
 function selectJob(id:string){ownership.current={selected:id,writable,session:undefined};setSelected(id);setBefore(undefined);setEditor(null);setCreate(false);}
 function ownsEditor(session:string,jobId:string){return ownership.current?.selected===jobId&&ownership.current.session===session&&ownership.current.writable;}

 return <section className="my-8 border-t pt-6"><h2 className="text-2xl font-semibold">Jobs</h2><p>AI suggestions require your review. Approved rubric history is immutable.</p>
 {error||list.error||detail.error?<p role="alert">{error||list.error?.message||detail.error?.message}</p>:null}
 {list.isPending&&<p role="status">Loading jobs…</p>}{list.data?.length===0&&<p>No jobs yet.</p>}
 <div className="my-3 flex flex-wrap gap-3">{list.data?.map(j=><Button key={j.id} onClick={()=>{selectJob(j.id);}}>{j.title} — {j.status}</Button>)}{after&&<Button onClick={()=>setAfter('')}>First jobs</Button>}{list.data?.length===50&&<Button onClick={()=>setAfter(list.data!.at(-1)!.id)}>More jobs</Button>}{canWrite&&<Button onClick={()=>{selectJob('');setCreate(!create);}}>New job</Button>}</div>
 {create&&canWrite&&<JobForm save={async data=>{const created=await api<Job>(base,{...data,requirements:[]});selectJob(created.id);await invalidate();}}/>}
 {selected&&detail.isPending&&<p role="status">Loading job…</p>}
 {job&&<article><h3 className="text-xl">{job.title}</h3><p>Status: {job.status} · Revision {job.revision}</p>
 {writable?<JobForm key={`${job.id}-${job.revision}`} job={job} save={async data=>{await api(`${base}/${job.id}`,{...data,revision:job.revision,requirements:data.description===job.description?job.requirements:[]});await invalidate();}}/>:<p className="whitespace-pre-wrap">{job.description}</p>}
 {writable&&<div className="flex flex-wrap gap-3">{transitions[job.status]?.map(status=><Button disabled={pending} key={status} onClick={()=>void action(()=>api(`${base}/${job.id}/status`,{status,revision:job.revision}))}>Set {status}</Button>)}</div>}
 <h4 className="mt-6 text-lg">Reviewed requirements</h4>{writable?<RequirementsEditor key={`${job.id}-${job.revision}`} job={job} save={saveRequirements}/>:job.requirements.map(r=><p key={r.key}>{r.text} — “{r.quote}”</p>)}
 {writable&&<div className="my-4 flex gap-3"><Button disabled={pending} onClick={()=>void action(()=>api(`${base}/${job.id}/ai`,{task:'job-analysis',revision:job.revision,idempotencyKey:crypto.randomUUID()}))}>Analyze job with AI</Button><Button disabled={pending||job.requirements.length===0} onClick={()=>void action(()=>api(`${base}/${job.id}/ai`,{task:'rubric-draft',revision:job.revision,idempotencyKey:crypto.randomUUID()}))}>Draft rubric with AI</Button><Button disabled={!job.requirements.length} onClick={()=>openEditor(job)}>Create manual rubric</Button></div>}
 <div aria-live="polite">{job.requests.map(r=><div className="my-2 border p-3" key={r.operationId}><p>{r.task}: {r.operation.status} · Attempts {r.operation.attemptCount} · AI mode: {r.mode} · Model: {r.model} {r.operation.failureCode}</p>{r.operation.status==='FAILED'&&writable&&<Button disabled={pending} onClick={()=>void action(()=>api(`${base}/${job.id}/ai`,{task:r.task,revision:job.revision,idempotencyKey:crypto.randomUUID()}))}>Retry {r.task} with current job</Button>}</div>)}</div>
 {job.artifacts.filter(a=>a.output.task==='job-analysis').map(a=><section className="my-3 border p-3" key={a.id}><h4>AI analysis suggestion</h4>{a.output.requirements?.map(r=><p key={r.key}>{r.text} — “{r.quote}”</p>)}{a.output.ambiguities?.map((v,i)=><p key={i}>Ambiguity: {v}</p>)}{a.output.missingInformation?.map((v,i)=><p key={i}>Missing: {v}</p>)}{writable&&<Button disabled={pending||!job.requests.some(r=>r.operationId===a.operationId&&r.jobRevision===job.revision)} onClick={()=>void action(()=>saveRequirements(a.output.requirements||[]))}>Use these requirements for review</Button>}</section>)}
 <h4 className="mt-6 text-lg">Rubric versions</h4>{configs.length===0&&<p>No rubric versions yet.</p>}
 {configs.map(c=><section className="my-3 border p-3" key={c.id}><h5>Version {c.version} — {c.status}</h5>{c.criteria.map(v=><details key={v.key}><summary>{v.label}: {v.weight/100}% · {v.evidenceRequirements}</summary><p>{v.description}</p><p>Requirements: {v.requirementKeys.join(', ')}</p>{v.anchors.map((anchor,rating)=><p key={rating}>Rating {rating}: {anchor}</p>)}</details>)}{writable&&<div className="flex gap-3"><Button onClick={()=>openEditor(job,c)}>{c.status==='DRAFT'?`Edit version ${c.version}`:`Copy version ${c.version} to new draft`}</Button>{c.status==='DRAFT'&&<Button disabled={pending||editor!==null} onClick={()=>void action(()=>approve(c))}>Approve version {c.version}</Button>}</div>}</section>)}
 <div className="flex gap-3">{before&&<Button onClick={()=>setBefore(undefined)}>Latest rubric versions</Button>}{history.data?.nextBefore&&<Button onClick={()=>setBefore(history.data!.nextBefore!)}>Older rubric versions</Button>}</div>{history.isPending&&<p role="status">Loading rubric history…</p>}{history.error&&<p role="alert">{history.error.message}</p>}
 {editor&&editor.job.id===selected&&writable&&<RubricEditor key={editor.session} job={editor.job} config={editor.config} reload={async()=>{const latestJob=await api<Detail>(`${base}/${editor.job.id}`);const latestConfig=editor.config?await api<Config>(`${base}/${editor.job.id}/rubrics/${editor.config.id}`):undefined;if(ownsEditor(editor.session,editor.job.id))openEditor(latestJob,latestConfig);}} save={async(criteria,existing)=>{if(!ownsEditor(editor.session,editor.job.id))throw new Error('This rubric editor is no longer active. Reopen the selected job’s rubric.');const config=editor.config;await api(`${base}/${editor.job.id}/drafts`,{criteria,revision:editor.job.revision,...(existing&&config?{configId:config.id,configRevision:config.revision}:{})});await invalidate();setEditor(current=>current?.session===editor.session?null:current);}}/>}
 </article>}
 </section>;
}
