const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fork}=require('node:child_process');
module.exports=async({db,security,identity,company,notifications})=>{
 const reset=await db.passwordResetToken.create({data:{userId:identity.userId,tokenHash:require('node:crypto').createHash('sha256').update(randomUUID()).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 const member=await db.companyMembership.findUniqueOrThrow({where:{companyId_userId:{companyId:company,userId:identity.userId}}});
 const invitation=await db.companyInvitation.create({data:{companyId:company,normalizedEmail:`expiry-${randomUUID()}@example.test`,role:'VIEWER',issuerMembershipId:member.id,tokenHash:require('node:crypto').createHash('sha256').update(randomUUID()).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 const auth=[];const tenant=[];const operations=[];const expiredIds=[];const pendingIds=[];
 for(let i=0;i<306;i++) {
  const expired=i>=101;const idA=randomUUID();const idT=randomUUID();const operationId=randomUUID();
  (expired?expiredIds:pendingIds).push(idA,idT);
  const sending=i===305;
  const data={status:sending?'SENDING':'PENDING',attemptCount:sending?1:0,leaseGeneration:sending?1:0,leaseExpiresAt:sending?new Date(Date.now()+60000):null,availableAt:new Date(Date.now()-(expired?86400000:172800000)),payloadExpiresAt:new Date(Date.now()+(expired?-60000:3600000))};
  auth.push({id:idA,userId:identity.userId,resetTokenId:reset.id,operationKey:idA,template:'password-reset',...data,...security.encrypt('synthetic token',`AUTH:${idA}`)});
  tenant.push({id:idT,companyId:company,operationId,invitationId:invitation.id,template:'team-invitation',...data,...security.encrypt('synthetic token',`TENANT:${company}:${idT}`)});
  operations.push({id:operationId,companyId:company,kind:'TEAM_INVITATION',idempotencyKey:operationId,status:sending?'RUNNING':'PENDING',attemptCount:data.attemptCount,leaseGeneration:data.leaseGeneration,leaseExpiresAt:data.leaseExpiresAt,deadlineAt:new Date(Date.now()+3600000),availableAt:data.availableAt});
 }
 await db.$transaction(async tx=>{await tx.processingOperation.createMany({data:operations});await tx.notificationDelivery.createMany({data:tenant});await tx.authNotificationDelivery.createMany({data:auth});});
 // Prove expired rows are outside the old availableAt-ordered dispatch batch.
 for(const model of [db.notificationDelivery,db.authNotificationDelivery]) {
  const first=await model.findMany({where:{id:{in:[...pendingIds,...expiredIds]}},orderBy:{availableAt:'asc'},take:100});assert(first.every(row=>row.payloadExpiresAt>new Date()));
 }
 const children=[];
 async function child(){const process=fork('/phase2/worker-child.cjs',[],{stdio:['ignore','ignore','ignore','ipc'],env:{...global.process.env,REDIS_URL:'redis://:synthetic@127.0.0.1:1',PHASE2_BLOCK_DISPATCH:'1'}});children.push(process);await new Promise((resolve,reject)=>{process.once('message',resolve);process.once('error',reject);});}
 try {
  await Promise.all([child(),child()]);
  for(let i=0;i<200;i++) {
   const count=await db.authNotificationDelivery.count({where:{id:{in:expiredIds},ciphertext:{not:null}}})+await db.notificationDelivery.count({where:{id:{in:expiredIds},ciphertext:{not:null}}});
   if(count===0)break;
   if(i===199)throw new Error('Expiry sweep starved beyond bounded recovery window');
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  for(const model of [db.notificationDelivery,db.authNotificationDelivery]) {
   assert.equal(await model.count({where:{id:{in:expiredIds},status:'EXPIRED',ciphertext:null,keyVersion:null,leaseExpiresAt:null}}),205);
   assert.equal(await model.count({where:{id:{in:pendingIds},status:'PENDING',ciphertext:{not:null},attemptCount:0}}),101);
   const rows=await model.findMany({where:{id:{in:expiredIds}}});assert(rows.every(row=>row.leaseGeneration===(row.attemptCount===1?2:1)));
  }
  assert.equal(await db.processingOperation.count({where:{id:{in:operations.slice(101).map(row=>row.id)},status:'CANCELLED',failureCode:'PAYLOAD_EXPIRED'}}),205);
  assert.equal(await notifications.sweepExpired(),0);assert.equal(await notifications.sweepExpired(),0);
  console.log('PASS F01 101 pending + 205 expired rows per scope, unavailable Redis, blocked dispatch, concurrent expiry workers and idempotent fencing');
 } finally {
  await Promise.all(children.map(child=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');})));
  await db.$transaction(async tx=>{
   const data={status:'CANCELLED',ciphertext:null,keyVersion:null,leaseExpiresAt:null};
   await tx.notificationDelivery.updateMany({where:{id:{in:pendingIds}},data});await tx.authNotificationDelivery.updateMany({where:{id:{in:pendingIds}},data});
   await tx.processingOperation.updateMany({where:{id:{in:operations.slice(0,101).map(row=>row.id)}},data:{status:'CANCELLED'}});
  });
 }
};
