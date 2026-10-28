const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async({app,load,db,call,infra,security})=>{
 const {AuthService}=load('/app/dist/auth/auth.service'); const auth=app.get(AuthService);
 const {CompanyService}=load('/app/dist/companies/company.service'); const companies=app.get(CompanyService);
 const {InvitationService}=load('/app/dist/memberships/invitation.service'); const invites=app.get(InvitationService);
 const {Notifications}=load('/app/dist/notifications/notifications'); const notifications=new Notifications(infra,security);
 const {NotificationRuntime}=load('/app/dist/notifications/runtime');
 const {digest}=load('/app/dist/auth/security');
 const {Queue}=load('bullmq'); const {redisOptions}=load('/app/dist/common/infrastructure');
 const password='Synthetic invitation password 123!'; const suffix=randomUUID();
 const ownerEmail=`owner-${suffix}@example.test`;
 const registered=await auth.register({email:ownerEmail,password,displayName:'Owner',companyName:'Invitations'});
 const identity=await security.verify(registered.accessToken); const company=(await companies.list(identity))[0].company.id;
 const other=await auth.register({email:`other-${suffix}@example.test`,password,displayName:'Other',companyName:'Other'});
 const otherIdentity=await security.verify(other.accessToken); const otherCompany=(await companies.list(otherIdentity))[0].company.id;
 const recipients=new Set([ownerEmail]);
 let runtime;
 const queue=new Queue('notifications',{connection:redisOptions(infra.env.REDIS_URL),prefix:`sr-${digest(new URL(infra.env.DATABASE_URL).pathname).slice(0,16)}`});
 async function fixture(label) {
  const email=`${label}-${randomUUID()}@example.test`; recipients.add(email);
  const created=await invites.create(identity,company,email,'VIEWER',randomUUID());
  const delivery=await db.notificationDelivery.findUniqueOrThrow({where:{operationId:created.operationId}});
  return {email,created,delivery,raw:security.decrypt(delivery.ciphertext,delivery.keyVersion,`TENANT:${company}:${delivery.id}`),job:{scope:'TENANT',companyId:company,deliveryId:delivery.id,operationId:created.operationId}};
 }
 async function row(f) {return db.notificationDelivery.findUniqueOrThrow({where:{id:f.delivery.id}});}
 async function due(f) {await db.notificationDelivery.update({where:{id:f.delivery.id},data:{availableAt:new Date(Date.now()-1)}});}
 async function waitFor(check) {for(let i=0;i<150;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw new Error('RECOVERY_TIMEOUT');}
 async function mailbox(email) {return (await (await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages;}
 try {
  const email=`new-${suffix}@example.test`; recipients.add(email); const body={email,role:'RECRUITER',idempotencyKey:randomUUID()};
  assert.equal((await call(`companies/${company}/invitations`,body,other.accessToken)).status,403);
  const issued=await call(`companies/${company}/invitations`,body,registered.accessToken); assert.equal(issued.status,201);
  assert.deepEqual((await call(`companies/${company}/invitations`,body,registered.accessToken)).body,issued.body);
  assert.equal((await call(`companies/${company}/invitations`,{...body,idempotencyKey:randomUUID()},registered.accessToken)).status,409);
  const delivery=await db.notificationDelivery.findUniqueOrThrow({where:{operationId:issued.body.operationId}});
  const raw=security.decrypt(delivery.ciphertext,delivery.keyVersion,`TENANT:${company}:${delivery.id}`);
  const job={scope:'TENANT',companyId:company,deliveryId:delivery.id,operationId:delivery.operationId};
  assert.equal(await db.outboxEvent.count({where:{companyId:company,operationId:delivery.operationId}}),1);
  await notifications.process({...job,companyId:otherCompany}); assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:delivery.id}})).attemptCount,0);
  await assert.rejects(()=>notifications.process({...job,token:raw}));
  await Promise.all([notifications.process(job),notifications.process(job)]);
  const sent=await db.notificationDelivery.findUniqueOrThrow({where:{id:delivery.id}}); assert.equal(sent.status,'SMTP_ACCEPTED');assert.equal(sent.attemptCount,1);assert.equal(sent.ciphertext,null);
  assert.equal((await db.processingOperation.findUniqueOrThrow({where:{id:delivery.operationId}})).status,'SUCCEEDED');
  const messages=await mailbox(email);assert.equal(messages.length,1);
  const message=await (await fetch(`http://mailpit:8025/api/v1/message/${messages[0].ID}`)).json();assert(message.Text.includes(`#token=${raw}`));
  assert.equal((await call('invitations/accept-new',{token:raw,password,displayName:'New recruit'})).status,201);
  assert.equal((await call('invitations/accept-new',{token:raw,password,displayName:'New recruit'})).status,401);
  const newUser=await db.user.findUniqueOrThrow({where:{normalizedEmail:email}});
  assert.equal((await db.companyMembership.findUniqueOrThrow({where:{companyId_userId:{companyId:company,userId:newUser.id}}})).role,'RECRUITER');
  // Existing-user acceptance requires the matching authenticated identity.
  const existingEmail=`other-${suffix}@example.test`;recipients.add(existingEmail);
  const existing=await invites.create(identity,company,existingEmail,'VIEWER',randomUUID());
  const ed=await db.notificationDelivery.findUniqueOrThrow({where:{operationId:existing.operationId}});const eraw=security.decrypt(ed.ciphertext,ed.keyVersion,`TENANT:${company}:${ed.id}`);
  assert.equal((await call('invitations/accept',{token:eraw},registered.accessToken)).status,401);
  assert.equal((await call('invitations/accept-new',{token:eraw,password,displayName:'Takeover'})).status,401);
  assert.equal((await call('invitations/accept',{token:eraw},other.accessToken)).status,201);
  assert.equal((await call(`companies/${company}/invitations`,{email:'forbidden@example.test',role:'COMPANY_ADMIN',idempotencyKey:randomUUID()},other.accessToken)).status,403);
  const revoked=await fixture('revoke');await invites.revoke(identity,company,revoked.created.id);await assert.rejects(()=>invites.accept(revoked.raw,undefined,password,'Revoked'));assert.equal((await row(revoked)).ciphertext,null);
  const expired=await fixture('expire');await db.companyInvitation.update({where:{id:expired.created.id},data:{createdAt:new Date(Date.now()-20000),expiresAt:new Date(Date.now()-10000)}});await assert.rejects(()=>invites.accept(expired.raw,undefined,password,'Expired'));await notifications.reconcile();assert.equal((await row(expired)).status,'EXPIRED');assert.equal((await row(expired)).ciphertext,null);
  const resend=await fixture('resend');await invites.resend(identity,company,resend.created.id,randomUUID());await assert.rejects(()=>invites.accept(resend.raw,undefined,password,'Old token'));assert.equal((await row(resend)).status,'CANCELLED');
  const race=await fixture('race');await Promise.allSettled([invites.resend(identity,company,race.created.id,randomUUID()),invites.revoke(identity,company,race.created.id)]);assert((await db.companyInvitation.findUniqueOrThrow({where:{id:race.created.id}})).revokedAt);assert.equal(await db.notificationDelivery.count({where:{invitationId:race.created.id,status:{in:['PENDING','SENDING','RETRY_WAIT']}}}),0);
  await assert.rejects(()=>invites.revoke(otherIdentity,otherCompany,resend.created.id));
  // Actual refused TCP connection, followed by real SMTP recovery.
  const retry=await fixture('retry');const outage=new Notifications({...infra,env:{...infra.env,SMTP_HOST:'127.0.0.1',SMTP_PORT:1}},security);
  await outage.process(retry.job);assert.equal((await row(retry)).status,'RETRY_WAIT');assert((await row(retry)).ciphertext);await due(retry);await notifications.process(retry.job);assert.equal((await row(retry)).status,'SMTP_ACCEPTED');assert.equal((await row(retry)).attemptCount,2);
  const failed=await fixture('terminal');for(let i=0;i<5;i++){await due(failed);await outage.process(failed.job);}assert.equal((await row(failed)).status,'FAILED');assert.equal((await row(failed)).ciphertext,null);await notifications.process(failed.job);assert.equal((await row(failed)).attemptCount,5);
  const permanent=await fixture('permanent');const rejected=new Notifications(infra,security);rejected.send=async()=>{throw Object.assign(new Error('synthetic SMTP rejection'),{responseCode:550});};await rejected.process(permanent.job);assert.equal((await row(permanent)).status,'FAILED');assert.equal((await row(permanent)).attemptCount,1);
  const corrupt=await fixture('corrupt');await db.notificationDelivery.update({where:{id:corrupt.delivery.id},data:{ciphertext:'invalid'}});await notifications.process(corrupt.job);assert.equal((await row(corrupt)).status,'FAILED');
  // Claim then abandon (process crash), followed by lease recovery in a new processor.
  const crash=await fixture('crash');let entered;const start=new Promise(r=>entered=r);let release;const blocked=new Promise(r=>release=r);const slow=new Notifications(infra,security);slow.send=async()=>{entered();await blocked;};
  const running=slow.process(crash.job);await start;
  await db.notificationDelivery.update({where:{id:crash.delivery.id},data:{leaseExpiresAt:new Date(Date.now()-1)}});
  const recovered=new Notifications(infra,security);await recovered.reconcile();release();await running;assert.equal((await row(crash)).status,'RETRY_WAIT');await due(crash);await recovered.process(crash.job);assert.equal((await row(crash)).status,'SMTP_ACCEPTED');assert.equal((await row(crash)).attemptCount,2);
  // Token revocation during an external send fences completion and purges ciphertext.
  const inflight=await fixture('inflight');let begin;const begun=new Promise(r=>begin=r);let finish;const finishWait=new Promise(r=>finish=r);const sender=new Notifications(infra,security);sender.send=async()=>{begin();await finishWait;};
  const sending=sender.process(inflight.job);await begun;await invites.revoke(identity,company,inflight.created.id);finish();await sending;assert.equal((await row(inflight)).status,'CANCELLED');assert.equal((await row(inflight)).ciphertext,null);
  // Password-reset SMTP uses global tables and generic public responses.
  await auth.requestReset(ownerEmail);const reset=await db.authNotificationDelivery.findFirstOrThrow({where:{userId:identity.userId,status:'PENDING'}});await notifications.process({scope:'AUTH',deliveryId:reset.id});assert.equal((await db.authNotificationDelivery.findUniqueOrThrow({where:{id:reset.id}})).status,'SMTP_ACCEPTED');assert((await mailbox(ownerEmail)).length>0);
  // Redis job loss: a published event survives obliteration of this isolated queue.
  const lost=await fixture('lost');await queue.add('deliver',lost.job,{jobId:`delivery-${lost.delivery.id}`});await notifications.published(lost.job);await queue.obliterate({force:true});
  runtime=new NotificationRuntime(infra,new Notifications(infra,security));await runtime.onModuleInit();await waitFor(async()=> (await row(lost)).status==='SMTP_ACCEPTED');await runtime.onModuleDestroy();runtime=undefined;
  const restart=await fixture('restart');runtime=new NotificationRuntime(infra,new Notifications(infra,security));await runtime.onModuleInit();await waitFor(async()=> (await row(restart)).status==='SMTP_ACCEPTED');await runtime.onModuleDestroy();runtime=undefined;
  // A separate process dies before dispatch; PostgreSQL survives and a replacement drains it.
  const {fork}=require('node:child_process');
  const abandoned=await fixture('process-restart');
  await db.notificationDelivery.update({where:{id:abandoned.delivery.id},data:{availableAt:new Date(Date.now()+60000)}});
  async function child(overrides={}) {const c=fork('/phase2/worker-child.cjs',[],{stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,...overrides}});await new Promise((resolve,reject)=>{c.once('message',resolve);c.once('error',reject);c.once('exit',code=>{if(code)reject(new Error('WORKER_START_FAILED'));});});return c;}
  const purge=await fixture('redis-outage-purge');await db.notificationDelivery.update({where:{id:purge.delivery.id},data:{payloadExpiresAt:new Date(Date.now()-1)}});
  const unavailable=await child({REDIS_URL:'redis://:synthetic-test-only@127.0.0.1:1'});try{await waitFor(async()=> (await row(purge)).status==='EXPIRED');assert.equal((await row(purge)).ciphertext,null);assert.equal((await row(abandoned)).status,'PENDING');}finally{const gone=new Promise(resolve=>unavailable.once('exit',resolve));unavailable.kill('SIGKILL');await gone;}
  const first=await child();const killed=new Promise(resolve=>first.once('exit',resolve));first.kill('SIGKILL');await killed;
  assert.equal((await row(abandoned)).status,'PENDING');await due(abandoned);
  const second=await child();try{await waitFor(async()=> (await row(abandoned)).status==='SMTP_ACCEPTED');}finally{const stopped=new Promise(resolve=>second.once('exit',resolve));second.kill('SIGTERM');await stopped;}
  assert(!JSON.stringify(lost.job).includes(lost.raw));
  await require('/phase2/expiry-runner.cjs')({db,security,identity,company,notifications});
  console.log('PASS invitations, actual Mailpit SMTP/reset, retry exhaustion, duplicate jobs, fenced recovery, Redis loss and worker restart');
 } finally {
  await runtime?.onModuleDestroy();await queue.obliterate({force:true});await queue.close();
  const ids=[];for(const email of recipients) for(const m of await mailbox(email)) ids.push(m.ID);
  if(ids.length) {const response=await fetch('http://mailpit:8025/api/v1/messages',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({IDs:[...new Set(ids)]})});assert(response.ok);}
 }
};
