const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async ({app,load,db,call,user,identity})=>{
 const {AuthService}=load('/app/dist/auth/auth.service'); const auth=app.get(AuthService);
 const {CompanyService,permitted}=load('/app/dist/companies/company.service'); const companies=app.get(CompanyService);
 const password='Synthetic tenant password 123!';
 async function person(label) {
  const email=`${label}-${randomUUID()}@example.test`;
  const result=await auth.register({email,password,displayName:label,companyName:label});
  const who=await app.get(load('/app/dist/auth/security').Security).verify(result.accessToken);
  const membership=await db.companyMembership.findFirstOrThrow({where:{userId:who.userId}});
  return {...who,access:result.accessToken,companyId:membership.companyId,memberId:membership.id};
 }
 const b=await person('B'); const recruiter=await person('recruiter'); const viewer=await person('viewer');
 const memberA=await db.companyMembership.findFirstOrThrow({where:{userId:user.id}}); const a=memberA.companyId;
 const live=await auth.login({email:user.normalizedEmail,password:'Changed synthetic password 456!'}); const admin=live.accessToken;
 const rec=await db.companyMembership.create({data:{companyId:a,userId:recruiter.userId,role:'RECRUITER'}});
 const view=await db.companyMembership.create({data:{companyId:a,userId:viewer.userId,role:'VIEWER'}});
 assert.equal((await call(`companies/${b.companyId}`,undefined,admin)).status,403);
 assert.equal((await call(`companies/${b.companyId}/settings`,{name:'Stolen',revision:1},admin)).status,403);
 assert.equal((await call(`companies/${a}`,undefined,b.access)).status,403);
 assert.equal((await call(`companies/${a}/members`,undefined,recruiter.access)).status,403);
 assert.equal((await call(`companies/${a}/members`,undefined,viewer.access)).status,403);
 for(const access of [recruiter.access,viewer.access]) assert.equal((await call(`companies/${a}/settings`,{name:'Forbidden',revision:1},access)).status,403);
 assert.equal((await call(`companies/${a}`,undefined,viewer.access)).status,200);
 assert(!permitted('VIEWER','recruitment:write')); assert(permitted('RECRUITER','recruitment:write')); assert(!permitted('RECRUITER','team:manage'));
 const listed=await call('companies',undefined,viewer.access); assert.equal(listed.body.length,2);
 const next=await call(`companies?after=${listed.body[0].company.id}`,undefined,viewer.access);assert.equal(next.body.length,1);assert.equal(next.body[0].company.id,listed.body[1].company.id);
 assert.equal((await call('companies?after=invalid',undefined,viewer.access)).status,400);
 assert.equal((await call(`companies/${a}/members/${b.memberId}`,{role:'VIEWER',status:'INACTIVE',revision:1},admin)).status,404);
 assert.equal((await call(`companies/${a}/settings`,{name:'Injected',revision:1,companyId:b.companyId},admin)).status,400);
 assert.equal((await call(`companies/${a}/members/${memberA.id}`,{role:'VIEWER',status:'ACTIVE',revision:1},admin)).status,409);
 assert.equal((await call(`companies/${a}/members/${view.id}`,{role:'VIEWER',status:'INACTIVE',revision:1},admin)).status,201);
 assert.equal((await call(`companies/${a}`,undefined,viewer.access)).status,403);
 assert.equal((await call(`companies/${viewer.companyId}`,undefined,viewer.access)).status,200);
 assert.equal((await call(`companies/${a}/members/${rec.id}`,{role:'COMPANY_ADMIN',status:'ACTIVE',revision:1},admin)).status,201);
 // Same JWT gains/loses rights from live membership, never embedded client role claims.
 assert.equal((await call(`companies/${a}/members`,undefined,recruiter.access)).status,200);
 const outcomes=await Promise.all([
  call(`companies/${a}/members/${memberA.id}`,{role:'VIEWER',status:'ACTIVE',revision:1},admin),
  call(`companies/${a}/members/${rec.id}`,{role:'VIEWER',status:'ACTIVE',revision:2},recruiter.access),
 ]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[201,409]);
 assert.equal(await db.companyMembership.count({where:{companyId:a,role:'COMPANY_ADMIN',status:'ACTIVE'}}),1);
 await assert.rejects(()=>companies.get(identity,b.companyId));
 console.log('PASS tenant HTTP read/write isolation, roles, guessed IDs, removal, workspace switching, last-admin race');
};
