# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2.spec.ts >> mounted workspace clears revoked data, preserves temporary failures and renews stale CSRF
- Location: tests/e2e/phase2.spec.ts:48:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - navigation [ref=f1e3]:
    - link "Service status" [ref=f1e4] [cursor=pointer]:
      - /url: /
    - link "Sign in" [ref=f1e5] [cursor=pointer]:
      - /url: /login
    - link "Register" [ref=f1e6] [cursor=pointer]:
      - /url: /register
    - link "Workspaces" [ref=f1e7] [cursor=pointer]:
      - /url: /workspace
  - main [ref=f1e8]:
    - generic [ref=f1e9]:
      - heading "SmartRecruit workspace" [level=1] [ref=f1e10]
      - button "Sign out" [ref=f1e11]
    - alert
    - text: Current workspace
    - combobox "Current workspace" [ref=f1e12]:
      - option "Select a workspace"
      - option "Protected A — COMPANY_ADMIN" [selected]
      - option "Independent B — COMPANY_ADMIN"
    - generic [ref=f1e13]:
      - heading "Protected A" [level=2] [ref=f1e14]
      - paragraph [ref=f1e15]: "Your role: COMPANY_ADMIN"
    - generic [ref=f1e16]:
      - heading "Jobs" [level=2] [ref=f1e17]
      - paragraph [ref=f1e18]: AI suggestions require your review. Approved rubric history is immutable.
      - paragraph [ref=f1e19]: No jobs yet.
      - button "New job" [ref=f1e21]
    - generic [ref=f1e22]:
      - heading "Workspace settings" [level=2] [ref=f1e23]
      - generic [ref=f1e24]:
        - generic [ref=f1e25]:
          - generic [ref=f1e26]: Company name
          - textbox "Company name" [ref=f1e27]: Protected A
        - button "Save company name" [ref=f1e28]
    - generic [ref=f1e29]:
      - heading "Invite a team member" [level=2] [ref=f1e30]
      - generic [ref=f1e31]:
        - generic [ref=f1e32]:
          - generic [ref=f1e33]: Invite email
          - textbox "Invite email" [ref=f1e34]
        - generic [ref=f1e35]:
          - generic [ref=f1e36]: Invitation role
          - combobox "Invitation role" [ref=f1e37]:
            - option "COMPANY_ADMIN"
            - option "RECRUITER"
            - option "VIEWER" [selected]
        - button "Send invitation" [ref=f1e38]
    - generic [ref=f1e39]:
      - heading "Team members" [level=2] [ref=f1e40]
      - article [ref=f1e41]:
        - heading "Mounted observer — observer-live-e39eb334-d185-4254-b0ba-0d262fae3323@example.test" [level=3] [ref=f1e42]
        - paragraph [ref=f1e43]: ACTIVE
        - generic [ref=f1e44]:
          - generic [ref=f1e45]:
            - generic [ref=f1e46]: Member role
            - combobox "Member role" [ref=f1e47]:
              - option "COMPANY_ADMIN" [selected]
              - option "RECRUITER"
              - option "VIEWER"
          - generic [ref=f1e48]:
            - generic [ref=f1e49]: Membership status
            - combobox "Membership status" [ref=f1e50]:
              - option "ACTIVE" [selected]
              - option "INACTIVE"
          - button "Update Mounted observer" [ref=f1e51]
      - article [ref=f1e52]:
        - heading "Other administrator — owner-live-e39eb334-d185-4254-b0ba-0d262fae3323@example.test" [level=3] [ref=f1e53]
        - paragraph [ref=f1e54]: ACTIVE
        - generic [ref=f1e55]:
          - generic [ref=f1e56]:
            - generic [ref=f1e57]: Member role
            - combobox "Member role" [ref=f1e58]:
              - option "COMPANY_ADMIN" [selected]
              - option "RECRUITER"
              - option "VIEWER"
          - generic [ref=f1e59]:
            - generic [ref=f1e60]: Membership status
            - combobox "Membership status" [ref=f1e61]:
              - option "ACTIVE" [selected]
              - option "INACTIVE"
          - button "Update Other administrator" [ref=f1e62]
    - generic [ref=f1e63]:
      - heading "Invitations and delivery" [level=2] [ref=f1e64]
      - paragraph [ref=f1e65]: No invitations yet.
    - generic [ref=f1e66]:
      - heading "Active sessions" [level=2] [ref=f1e67]
      - generic [ref=f1e68]:
        - generic [ref=f1e69]: Expires 11/28/2026, 9:09:00 PM
        - button "Revoke session" [ref=f1e70]
```

# Test source

```ts
  1  | import {test,expect} from '@playwright/test';
  2  | import {randomUUID} from 'node:crypto';
  3  | import {spawnSync} from 'node:child_process';
  4  | test.skip(process.env.PHASE2_E2E!=='1','Use the isolated-database browser wrapper.');
  5  | function docker(args:string[]) {const result=spawnSync('docker',['compose',...args],{encoding:'utf8'});if(result.status!==0)throw new Error('Docker verification command failed');return result.stdout;}
  6  | async function mailLink(email:string) {
  7  |  let link='';
  8  |  await expect.poll(()=>{
  9  |   // Output is captured privately; no token-bearing URLs are printed or logged.
  10 |   link=docker(['exec','-T','api','node','-e',`(async()=>{const list=await(await fetch('http://mailpit:8025/api/v1/search?query='+encodeURIComponent('to:'+process.argv[1]))).json();if(!list.messages.length)return;const m=await(await fetch('http://mailpit:8025/api/v1/message/'+list.messages[0].ID)).json();process.stdout.write(m.Text.match(/http[^\\s]+#token=[A-Za-z0-9_-]+/)?.[0]||'');})().catch(()=>process.exit(1))`,email]);
  11 |   return Boolean(link);
  12 |  },{timeout:20000}).toBe(true);
  13 |  return link;
  14 | }
  15 | test('register, workspaces, team email acceptance, sessions and password reset',async({page,browser})=>{
  16 |  test.setTimeout(180000);
  17 |  const suffix=randomUUID();const email=`browser-${suffix}@example.test`;const invited=`invited-${suffix}@example.test`;const password='Browser synthetic password 123!';
  18 |  const recipients=[email,invited];
  19 |  try {
  20 |   await page.goto('/register');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Your name').fill('Browser Admin');await page.getByLabel('Company name',{exact:true}).fill('Browser A');await page.getByRole('button',{name:'Create your workspace'}).click();
  21 |   await expect(page.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();
  22 |   const secondTab=await page.context().newPage();await Promise.all([page.reload(),secondTab.goto('/workspace')]);await expect(secondTab.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();await expect(page.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();await secondTab.close();expect(await page.evaluate(()=>Object.keys(localStorage))).toEqual([]);
  23 |   await page.getByLabel('Current workspace').selectOption({label:'Browser A — COMPANY_ADMIN'});await expect(page.getByRole('heading',{name:'Team members',exact:true})).toBeVisible();
  24 |   const companyA=page.url();
  25 |   await page.getByLabel('Company name',{exact:true}).fill('Browser A renamed');await page.getByRole('button',{name:'Save company name'}).click();await expect(page.getByRole('heading',{name:'Browser A renamed',exact:true})).toBeVisible();
  26 |   docker(['stop','worker']);
  27 |   await page.getByLabel('Invite email').fill(invited);await page.getByLabel('Invitation role').selectOption('VIEWER');await page.getByRole('button',{name:'Send invitation'}).click();await expect(page.getByText(`${invited} — VIEWER`,{exact:true})).toBeVisible();
  28 |   // Intent survives an API restart and a stopped worker.
  29 |   docker(['restart','api']);docker(['start','worker']);
  30 |   await expect.poll(async()=>{try{return (await page.request.get('/api/health/ready',{timeout:2000})).status();}catch{return 0;}},{timeout:30000}).toBe(200);
  31 |   const inviteLink=await mailLink(invited);
  32 |   const context=await browser.newContext();const candidate=await context.newPage();
  33 |   await candidate.goto(inviteLink);await expect(candidate).not.toHaveURL(/#token=/);await candidate.getByLabel('Your name').fill('Invited Viewer');await candidate.getByLabel('Password',{exact:true}).fill(password);await candidate.getByRole('button',{name:'Accept team invitation'}).click();await expect(candidate.getByText('Invitation accepted. You can sign in and open the workspace.')).toBeVisible();
  34 |   await candidate.goto('/login');await candidate.getByLabel('Email',{exact:true}).fill(invited);await candidate.getByLabel('Password',{exact:true}).fill(password);await candidate.getByRole('button',{name:'Sign in',exact:true}).click();await expect(candidate.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();await candidate.getByLabel('Current workspace').selectOption({label:'Browser A renamed — VIEWER'});await expect(candidate.getByText('Your role: VIEWER')).toBeVisible();await expect(candidate.getByRole('heading',{name:'Team members'})).toHaveCount(0);
  35 |   await candidate.goto('/workspace');await candidate.getByLabel('Workspace name').fill('Viewer-owned B');await candidate.getByRole('button',{name:'Create workspace'}).click();await expect(candidate.getByRole('heading',{name:'Viewer-owned B',exact:true})).toBeVisible();await candidate.getByLabel('Current workspace').selectOption({label:'Browser A renamed — VIEWER'});await expect(candidate.getByRole('heading',{name:'Invite a team member'})).toHaveCount(0);
  36 |   await candidate.getByRole('button',{name:'Sign out'}).click();await expect(candidate.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();await context.close();
  37 |   await page.goto(companyA);await expect(page.getByRole('heading',{name:'Team members',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out'}).click();
  38 |   await page.goto('/reset-request');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByRole('button',{name:'Request password reset'}).click();await expect(page.getByText('If the account is eligible, a password reset email will be sent.')).toBeVisible();
  39 |   const resetLink=await mailLink(email);await page.goto(resetLink);await expect(page).not.toHaveURL(/#token=/);await page.getByLabel('New password').fill('Changed browser password 456!');await page.getByRole('button',{name:'Set a new password'}).click();await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();
  40 |   await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Changed browser password 456!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();await expect(page.getByRole('heading',{name:'Active sessions'})).toBeVisible();
  41 |   await page.getByRole('button',{name:'Revoke session',exact:true}).first().click();await page.reload();await expect(page.getByText('Sign in to open your workspace.',{exact:true})).toBeVisible();
  42 |  } finally {
  43 |   docker(['start','worker']);
  44 |   for(const recipient of recipients)docker(['exec','-T','api','node','-e',`(async()=>{const r=await(await fetch('http://mailpit:8025/api/v1/search?query='+encodeURIComponent('to:'+process.argv[1]))).json();const IDs=r.messages.map(m=>m.ID);if(IDs.length)await fetch('http://mailpit:8025/api/v1/messages',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({IDs})});})().catch(()=>process.exit(1))`,recipient]);
  45 |  }
  46 | });
  47 | 
  48 | test('mounted workspace clears revoked data, preserves temporary failures and renews stale CSRF',async({page,request})=>{
  49 |  test.setTimeout(120000);
  50 |  const suffix=randomUUID();const owner=`owner-live-${suffix}@example.test`;const observer=`observer-live-${suffix}@example.test`;const password='Mounted browser password 123!';
  51 |  const origin='http://localhost:8080';
  52 |  const csrf=(await (await request.get('/api/v1/auth/csrf')).json()).csrfToken;
  53 |  const registered=await request.post('/api/v1/auth/register',{headers:{origin,'x-csrf-token':csrf},data:{email:owner,password,displayName:'Other administrator',companyName:'Protected A'}});expect(registered.status()).toBe(201);
  54 |  const ownerAccess=(await registered.json()).accessToken;
  55 |  const owned=await (await request.get('/api/v1/companies',{headers:{authorization:`Bearer ${ownerAccess}`}})).json();const companyA=owned[0].company.id;
  56 |  await page.goto('/register');await page.getByLabel('Email',{exact:true}).fill(observer);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Your name').fill('Mounted observer');await page.getByLabel('Company name',{exact:true}).fill('Independent B');await page.getByRole('button',{name:'Create your workspace'}).click();await expect(page.getByRole('heading',{name:'SmartRecruit workspace'})).toBeVisible();
  57 |  const memberId=docker(['exec','-T','api','node','-e',`const {PrismaClient}=require('./generated/client');const db=new PrismaClient();(async()=>{const user=await db.user.findUniqueOrThrow({where:{normalizedEmail:process.argv[1]}});const m=await db.companyMembership.create({data:{companyId:process.argv[2],userId:user.id,role:'COMPANY_ADMIN'}});process.stdout.write(m.id);})().finally(()=>db.$disconnect());`,observer,companyA]);
  58 |  await page.goto('/workspace');await page.getByLabel('Current workspace').selectOption({label:'Protected A — COMPANY_ADMIN'});await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toBeVisible();
  59 |  // Change the HttpOnly CSRF cookie as another tab/expiry would, then force the
  60 |  // next authenticated query through refresh. The real backend rejects stale CSRF.
  61 |  const cookies=await page.context().cookies();const cookie=cookies.find(c=>c.name==='sr_csrf')!;
  62 |  await page.context().addCookies([{...cookie,value:'expired-or-replaced-csrf'}]);
  63 |  const refreshStatuses:number[]=[];page.on('response',response=>{if(new URL(response.url()).pathname==='/api/v1/auth/refresh')refreshStatuses.push(response.status());});
  64 |  await page.route('**/api/v1/auth/sessions',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'AUTH_REQUIRED'})}),{times:1});
> 65 |  await expect.poll(()=>refreshStatuses.includes(403)&&refreshStatuses.includes(201),{timeout:15000}).toBe(true);
     |                                                                                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  66 |  await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toBeVisible();
  67 |  // A transient network failure must not be interpreted as revocation.
  68 |  await page.route(`**/api/v1/companies/${companyA}*`,route=>route.abort('failed'));
  69 |  await expect.poll(async()=>await page.locator('[role="alert"]').allTextContents(),{timeout:10000}).toContain('Failed to fetch');
  70 |  await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toBeVisible();await page.unroute(`**/api/v1/companies/${companyA}*`);
  71 |  async function change(role:string,status:string,revision:number){const result=await request.post(`/api/v1/companies/${companyA}/members/${memberId}`,{headers:{origin,'x-csrf-token':csrf,authorization:`Bearer ${ownerAccess}`},data:{role,status,revision}});expect(result.status()).toBe(201);}
  72 |  await change('VIEWER','ACTIVE',1);
  73 |  await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toHaveCount(0,{timeout:15000});await expect(page.getByRole('heading',{name:'Team members',exact:true})).toHaveCount(0);
  74 |  await page.getByLabel('Current workspace').selectOption({label:'Independent B — COMPANY_ADMIN'});await expect(page.getByRole('heading',{name:'Independent B',exact:true})).toBeVisible();await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toHaveCount(0);
  75 |  await change('COMPANY_ADMIN','ACTIVE',2);await page.getByLabel('Current workspace').selectOption(companyA);await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toBeVisible();
  76 |  await change('COMPANY_ADMIN','INACTIVE',3);await expect(page.getByText(`Other administrator — ${owner}`,{exact:true})).toHaveCount(0,{timeout:15000});await expect(page.getByText('Workspace access changed. Select a workspace to recheck your access.')).toBeVisible();
  77 |  await page.getByLabel('Current workspace').selectOption({label:'Independent B — COMPANY_ADMIN'});await expect(page.getByRole('heading',{name:'Team members',exact:true})).toBeVisible();
  78 |  // External session revocation while React remains mounted, without navigation.
  79 |  const freshCsrf=(await (await page.request.get('/api/v1/auth/csrf')).json()).csrfToken;
  80 |  const renewed=await page.request.post('/api/v1/auth/refresh',{headers:{origin,'x-csrf-token':freshCsrf},data:{}});expect(renewed.status()).toBe(201);const access=(await renewed.json()).accessToken;
  81 |  const sessions=await (await page.request.get('/api/v1/auth/sessions',{headers:{authorization:`Bearer ${access}`}})).json();
  82 |  for(const session of sessions){const revoked=await page.request.post(`/api/v1/auth/sessions/${session.familyId}/revoke`,{headers:{origin,'x-csrf-token':freshCsrf,authorization:`Bearer ${access}`},data:{}});expect(revoked.status()).toBe(201);}
  83 |  await expect(page.getByText('Sign in to open your workspace.',{exact:true})).toBeVisible({timeout:15000});await expect(page.getByRole('heading',{name:'Team members',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Independent B',exact:true})).toHaveCount(0);
  84 | });
  85 | 
```