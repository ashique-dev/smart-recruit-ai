const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async({app,load,db,call,security})=>{
 const {AuthService}=load('/app/dist/auth/auth.service');const auth=app.get(AuthService);
 const {InvitationService}=load('/app/dist/memberships/invitation.service');const invites=app.get(InvitationService);
 const {verifyPassword,digest}=load('/app/dist/auth/security');
 const password='Original race password 123!';
 async function fixture(label){const email=`${label}-${randomUUID()}@example.test`;const session=await auth.register({email,password,displayName:label,companyName:label});const identity=await security.verify(session.accessToken);return {email,session,identity};}
 async function resetToken(person){await auth.requestReset(person.email);const delivery=await db.authNotificationDelivery.findFirstOrThrow({where:{userId:person.identity.userId,status:'PENDING'}});return {raw:security.decrypt(delivery.ciphertext,delivery.keyVersion,`AUTH:${delivery.id}`),id:delivery.resetTokenId};}
 const refreshed=(raw)=>call('auth/refresh',{},undefined,{cookies:false,refreshToken:raw});
 // A: retain live credentials across reset; no prior logout/revocation.
 const a=await fixture('reset-live');const resetA=await resetToken(a);
 assert.equal((await call('auth/me',undefined,a.session.accessToken)).status,200);
 assert.equal((await call('auth/reset',{token:resetA.raw,password:'Changed live password 456!'})).status,201);
 assert.equal((await call('auth/me',undefined,a.session.accessToken)).status,401);
 assert.equal((await refreshed(a.session.refreshToken)).status,401);
 assert.equal((await call('auth/login',{email:a.email,password:'Changed live password 456!'},undefined,{cookies:false})).status,201);
 assert.equal((await call('auth/login',{email:a.email,password},undefined,{cookies:false})).status,401);
 // B: same token, two different passwords, simultaneous actual HTTP requests.
 const b=await fixture('reset-consume');const resetB=await resetToken(b);const passwords=['First competing password 123!','Second competing password 456!'];
 const results=await Promise.all(passwords.map(password=>call('auth/reset',{token:resetB.raw,password})));
 assert.deepEqual(results.map(r=>r.status).sort(),[201,401]);
 const winner=results.findIndex(r=>r.status===201);const user=await db.user.findUniqueOrThrow({where:{id:b.identity.userId}});
 assert(await verifyPassword(user.passwordHash,passwords[winner]));assert(!await verifyPassword(user.passwordHash,passwords[1-winner]));
 assert.equal(await db.authSecurityEvent.count({where:{userId:user.id,kind:'PASSWORD_RESET'}}),1);
 assert((await db.passwordResetToken.findUniqueOrThrow({where:{id:resetB.id}})).consumedAt);
 assert.equal(await db.refreshSession.count({where:{userId:user.id,revokedAt:null}}),0);
 assert.equal((await call('auth/reset',{token:resetB.raw,password:passwords[1-winner]})).status,401);
 assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).passwordHash,user.passwordHash);
 // C: concurrent invitation acceptance creates one identity, membership and audit effect.
 const c=await fixture('invite-consume');const company=await db.companyMembership.findFirstOrThrow({where:{userId:c.identity.userId}});
 const invited=`concurrent-invite-${randomUUID()}@example.test`;
 const created=await invites.create(c.identity,company.companyId,invited,'RECRUITER',randomUUID());
 const delivery=await db.notificationDelivery.findUniqueOrThrow({where:{operationId:created.operationId}});
 const raw=security.decrypt(delivery.ciphertext,delivery.keyVersion,`TENANT:${company.companyId}:${delivery.id}`);
 const accepted=await Promise.all([0,1].map(()=>call('invitations/accept-new',{token:raw,password,displayName:'Concurrent member'})));
 assert.deepEqual(accepted.map(r=>r.status).sort(),[201,401]);
 const invitedUser=await db.user.findUniqueOrThrow({where:{normalizedEmail:invited}});
 assert.equal(await db.companyMembership.count({where:{userId:invitedUser.id}}),1);
 const member=await db.companyMembership.findUniqueOrThrow({where:{companyId_userId:{companyId:company.companyId,userId:invitedUser.id}}});assert.equal(member.role,'RECRUITER');
 assert.equal(await db.auditLog.count({where:{companyId:company.companyId,entityId:created.id,action:'INVITATION_ACCEPTED'}}),1);
 assert((await db.companyInvitation.findUniqueOrThrow({where:{id:created.id}})).consumedAt);
 assert.equal((await call('invitations/accept-new',{token:raw,password,displayName:'Replay'})).status,401);
 // D: either refresh wins before reset and its successor is revoked, or reset wins
 // and refresh is rejected. Both serializations must leave no live old family.
 const d=await fixture('reset-refresh');const resetD=await resetToken(d);
 const [changed,rotated]=await Promise.all([call('auth/reset',{token:resetD.raw,password:'Race winner password 789!'}),refreshed(d.session.refreshToken)]);
 assert.equal(changed.status,201);assert([201,401].includes(rotated.status));
 const family=await db.refreshSession.findUniqueOrThrow({where:{tokenHash:digest(d.session.refreshToken)}});
 assert.equal(await db.refreshSession.count({where:{userId:d.identity.userId,revokedAt:null}}),0);
 assert.equal((await call('auth/me',undefined,d.session.accessToken)).status,401);
 assert.equal((await refreshed(d.session.refreshToken)).status,401);
 if(rotated.status===201){
  assert.equal((await call('auth/me',undefined,rotated.body.accessToken)).status,401);
  const successor=rotated.cookies.find(value=>value.startsWith('sr_refresh=')).split(';')[0].slice('sr_refresh='.length);
  assert.equal((await refreshed(successor)).status,401);
 }
 assert.equal(await db.refreshSession.count({where:{familyId:family.familyId,revokedAt:null}}),0);
 assert.equal(await db.authSecurityEvent.count({where:{userId:d.identity.userId,kind:'PASSWORD_RESET'}}),1);
 console.log('PASS F04 live-session reset invalidation, concurrent reset/invitation consumption, reset-versus-refresh PostgreSQL effects');
};
