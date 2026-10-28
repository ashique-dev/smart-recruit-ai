import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
test.skip(process.env.PHASE2_E2E!=='1','Use the isolated-database browser wrapper.');
function docker(args:string[]) {const result=spawnSync('docker',['compose',...args],{encoding:'utf8'});if(result.status!==0)throw new Error('Docker verification command failed');return result.stdout;}
async function mailLink(email:string) {
 let link='';
 await expect.poll(()=>{
  // Output is captured privately; no token-bearing URLs are printed or logged.
  link=docker(['exec','-T','api','node','-e',`(async()=>{const list=await(await fetch('http://mailpit:8025/api/v1/search?query='+encodeURIComponent('to:'+process.argv[1]))).json();if(!list.messages.length)return;const m=await(await fetch('http://mailpit:8025/api/v1/message/'+list.messages[0].ID)).json();process.stdout.write(m.Text.match(/http[^\\s]+#token=[A-Za-z0-9_-]+/)?.[0]||'');})().catch(()=>process.exit(1))`,email]);
  return Boolean(link);
 },{timeout:20000}).toBe(true);
 return link;
}
test('register, workspaces, team email acceptance, sessions and password reset',async({page,browser})=>{
 test.setTimeout(180000);
 const suffix=randomUUID();const email=`browser-${suffix}@example.test`;const invited=`invited-${suffix}@example.test`;const password='Browser synthetic password 123!';
 const recipients=[email,invited];
 try {
  await page.goto('/register');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Your name').fill('Browser Admin');await page.getByLabel('Company name',{exact:true}).fill('Browser A');await page.getByRole('button',{name:'Create your workspace'}).click();
  await expect(page.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();
  const secondTab=await page.context().newPage();await Promise.all([page.reload(),secondTab.goto('/workspace')]);await expect(secondTab.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();await expect(page.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();await secondTab.close();expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
  await page.getByLabel('Current workspace').selectOption({label:'Browser A — COMPANY_ADMIN'});await expect(page.getByRole('heading',{name:'Team members',exact:true})).toBeVisible();
  const companyA=page.url();
  await page.getByLabel('Company name',{exact:true}).fill('Browser A renamed');await page.getByRole('button',{name:'Save company name'}).click();await expect(page.getByRole('heading',{name:'Browser A renamed',exact:true})).toBeVisible();
  docker(['stop','worker']);
  await page.getByLabel('Invite email').fill(invited);await page.getByLabel('Invitation role').selectOption('VIEWER');await page.getByRole('button',{name:'Send invitation'}).click();await expect(page.getByText(`${invited} — VIEWER`,{exact:true})).toBeVisible();
  // Intent survives an API restart and a stopped worker.
  docker(['restart','api']);docker(['start','worker']);
  await expect.poll(async()=>{try{return (await page.request.get('/api/health/ready',{timeout:2000})).status();}catch{return 0;}},{timeout:30000}).toBe(200);
  const inviteLink=await mailLink(invited);
  const context=await browser.newContext();const candidate=await context.newPage();
  await candidate.goto(inviteLink);await expect(candidate).not.toHaveURL(/#token=/);await candidate.getByLabel('Your name').fill('Invited Viewer');await candidate.getByLabel('Password',{exact:true}).fill(password);await candidate.getByRole('button',{name:'Accept team invitation'}).click();await expect(candidate.getByText('Invitation accepted. You can sign in and open the workspace.')).toBeVisible();
  await candidate.goto('/login');await candidate.getByLabel('Email',{exact:true}).fill(invited);await candidate.getByLabel('Password',{exact:true}).fill(password);await candidate.getByRole('button',{name:'Sign in',exact:true}).click();await expect(candidate.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();await candidate.getByLabel('Current workspace').selectOption({label:'Browser A renamed — VIEWER'});await expect(candidate.getByText('Your role: VIEWER')).toBeVisible();await expect(candidate.getByRole('heading',{name:'Team members'})).toHaveCount(0);
  await candidate.goto('/workspace');await candidate.getByLabel('Workspace name').fill('Viewer-owned B');await candidate.getByRole('button',{name:'Create workspace'}).click();await expect(candidate.getByRole('heading',{name:'Viewer-owned B',exact:true})).toBeVisible();await candidate.getByLabel('Current workspace').selectOption({label:'Browser A renamed — VIEWER'});await expect(candidate.getByRole('heading',{name:'Invite a team member'})).toHaveCount(0);
  await candidate.getByRole('button',{name:'Sign out'}).click();await expect(candidate.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();await context.close();
  await page.goto(companyA);await expect(page.getByRole('heading',{name:'Team members',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out'}).click();
  await page.goto('/reset-request');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByRole('button',{name:'Request password reset'}).click();await expect(page.getByText('If the account is eligible, a password reset email will be sent.')).toBeVisible();
  const resetLink=await mailLink(email);await page.goto(resetLink);await expect(page).not.toHaveURL(/#token=/);await page.getByLabel('New password').fill('Changed browser password 456!');await page.getByRole('button',{name:'Set a new password'}).click();await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();
  await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Changed browser password 456!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();await expect(page.getByRole('heading',{name:'Active sessions'})).toBeVisible();
  await page.getByRole('button',{name:'Revoke session',exact:true}).first().click();await page.reload();await expect(page.getByText('Sign in to open your workspace.',{exact:true})).toBeVisible();
 } finally {
  docker(['start','worker']);
  for(const recipient of recipients)docker(['exec','-T','api','node','-e',`(async()=>{const r=await(await fetch('http://mailpit:8025/api/v1/search?query='+encodeURIComponent('to:'+process.argv[1]))).json();const IDs=r.messages.map(m=>m.ID);if(IDs.length)await fetch('http://mailpit:8025/api/v1/messages',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({IDs})});})().catch(()=>process.exit(1))`,recipient]);
 }
});

test('mounted workspace clears revoked data, preserves temporary failures and renews stale CSRF',async({page,request})=>{
 test.setTimeout(120000);
 const suffix=randomUUID();const owner=`owner-live-${suffix}@example.test`;const observer=`observer-live-${suffix}@example.test`;const password='Mounted browser password 123!';
 const origin='http://localhost:8080';
 const csrf=(await (await request.get('/api/v1/auth/csrf')).json()).csrfToken;
 const registered=await request.post('/api/v1/auth/register',{headers:{origin,'x-csrf-token':csrf},data:{email:owner,password,displayName:'Other administrator',companyName:'Protected A'}});expect(registered.status()).toBe(201);
 const ownerAccess=(await registered.json()).accessToken;
 const owned=await (await request.get('/api/v1/companies',{headers:{authorization:`Bearer ${ownerAccess}`}})).json();const companyA=owned[0].company.id;
 await page.goto('/register');await page.getByLabel('Email',{exact:true}).fill(observer);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Your name').fill('Mounted observer');await page.getByLabel('Company name',{exact:true}).fill('Independent B');await page.getByRole('button',{name:'Create your workspace'}).click();await expect(page.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();
 const memberId=docker(['exec','-T','api','node','-e',`const {PrismaClient}=require('./generated/client');const db=new PrismaClient();(async()=>{const user=await db.user.findUniqueOrThrow({where:{normalizedEmail:process.argv[1]}});const m=await db.companyMembership.create({data:{companyId:process.argv[2],userId:user.id,role:'COMPANY_ADMIN'}});process.stdout.write(m.id);})().finally(()=>db.$disconnect());`,observer,companyA]);
 await page.goto('/workspace');await page.getByLabel('Current workspace').selectOption({label:'Protected A — COMPANY_ADMIN'});await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toBeVisible();
 // Change the HttpOnly CSRF cookie as another tab/expiry would, then force the
 // next authenticated query through refresh. The real backend rejects stale CSRF.
 const cookies=await page.context().cookies();const cookie=cookies.find(c=>c.name==='sr_csrf')!;
 await page.context().addCookies([{...cookie,value:'expired-or-replaced-csrf'}]);
 const refreshStatuses:number[]=[];page.on('response',response=>{if(new URL(response.url()).pathname==='/api/v1/auth/refresh')refreshStatuses.push(response.status());});
 await page.route('**/api/v1/auth/sessions',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'AUTH_REQUIRED'})}),{times:1});
 await expect.poll(()=>refreshStatuses.includes(403)&&refreshStatuses.includes(201),{timeout:15000}).toBe(true);
 await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toBeVisible();
 // A transient network failure must not be interpreted as revocation.
 await page.route(`**/api/v1/companies/${companyA}*`,route=>route.abort('failed'));
 await expect.poll(async()=>await page.locator('[role="alert"]').allTextContents(),{timeout:10000}).toContain('Failed to fetch');
 await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toBeVisible();await page.unroute(`**/api/v1/companies/${companyA}*`);
 async function change(role:string,status:string,revision:number){const result=await request.post(`/api/v1/companies/${companyA}/members/${memberId}`,{headers:{origin,'x-csrf-token':csrf,authorization:`Bearer ${ownerAccess}`},data:{role,status,revision}});expect(result.status()).toBe(201);}
 await change('VIEWER','ACTIVE',1);
 await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toHaveCount(0,{timeout:15000});await expect(page.getByRole('heading',{name:'Team members',exact:true})).toHaveCount(0);
 await page.getByLabel('Current workspace').selectOption({label:'Independent B — COMPANY_ADMIN'});await expect(page.getByRole('heading',{name:'Independent B',exact:true})).toBeVisible();await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toHaveCount(0);
 await change('COMPANY_ADMIN','ACTIVE',2);await page.getByLabel('Current workspace').selectOption(companyA);await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toBeVisible();
 await change('COMPANY_ADMIN','INACTIVE',3);await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toHaveCount(0,{timeout:15000});await expect(page.getByText('Workspace access changed. Select a workspace to recheck your access.')).toBeVisible();
 await page.getByLabel('Current workspace').selectOption({label:'Independent B — COMPANY_ADMIN'});await expect(page.getByRole('heading',{name:'Team members',exact:true})).toBeVisible();
 // External session revocation while React remains mounted, without navigation.
 const freshCsrf=(await (await page.request.get('/api/v1/auth/csrf')).json()).csrfToken;
 const renewed=await page.request.post('/api/v1/auth/refresh',{headers:{origin,'x-csrf-token':freshCsrf},data:{}});expect(renewed.status()).toBe(201);const access=(await renewed.json()).accessToken;
 const sessions=await (await page.request.get('/api/v1/auth/sessions',{headers:{authorization:`Bearer ${access}`}})).json();
 for(const session of sessions){const revoked=await page.request.post(`/api/v1/auth/sessions/${session.familyId}/revoke`,{headers:{origin,'x-csrf-token':freshCsrf,authorization:`Bearer ${access}`},data:{}});expect(revoked.status()).toBe(201);}
 await expect(page.getByText('Sign in to open your workspace.',{exact:true})).toBeVisible({timeout:15000});await expect(page.getByRole('heading',{name:'Team members',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Independent B',exact:true})).toHaveCount(0);
});
