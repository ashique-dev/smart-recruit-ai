const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const load = createRequire('/app/package.json');
const url = new URL(process.env.DATABASE_URL); url.pathname = `/${process.env.PHASE2_TEST_DB}`; process.env.DATABASE_URL = url.toString();
process.env.AUTH_SIGNING_KEY=randomBytes(32).toString('hex');
process.env.CSRF_KEY=randomBytes(32).toString('hex');
process.env.NOTIFICATION_ENCRYPTION_KEY=randomBytes(32).toString('hex');
load('reflect-metadata');
const { NestFactory }=load('@nestjs/core');
const { ValidationPipe }=load('@nestjs/common');
const { AppModule }=load('/app/dist/app.module');
const { Infrastructure }=load('/app/dist/common/infrastructure');
const { Security, digest, passwordOptions, hashPassword, verifyPassword }=load('/app/dist/auth/security');
const { SignJWT }=load('jose');
async function main() {
 const app=await NestFactory.create(AppModule,{logger:false});
 app.setGlobalPrefix('api/v1');
 app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
 await app.listen(0,'127.0.0.1');
 const base=await app.getUrl(); const infra=app.get(Infrastructure); const db=infra.prisma; const security=app.get(Security);
 const prefix=randomUUID(); let csrf; let jar={};
 async function call(path,body,access,options={}) {
   const headers={origin:infra.env.CORS_ORIGIN,'content-type':'application/json',cookie:Object.entries(options.refreshToken?{...jar,sr_refresh:options.refreshToken}:jar).map(([k,v])=>`${k}=${v}`).join('; '),'x-csrf-token':csrf,...(access?{authorization:`Bearer ${access}`}:{ }),...options.headers};
   const response=await fetch(`${base}/api/v1/${path}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
   if (options.cookies!==false) for (const value of response.headers.getSetCookie()) { const pair=value.split(';')[0]; const index=pair.indexOf('='); jar[pair.slice(0,index)]=pair.slice(index+1); }
   return {status:response.status,body:await response.json(),cookies:response.headers.getSetCookie()};
 }
 try {
   const issued=await call('auth/csrf'); csrf=issued.body.csrfToken;
   assert.match(issued.cookies[0],/HttpOnly/); assert.match(issued.cookies[0],/SameSite=Strict/i);
   const email=`${prefix}@example.test`; const password='Synthetic password 123!';
   const input={email,password,displayName:'Synthetic',companyName:'Company A'};
   assert.equal((await call('auth/register',input,undefined,{headers:{'x-csrf-token':''}})).status,403);
   assert.equal((await call('auth/register',input,undefined,{headers:{origin:'https://evil.example'}})).status,403);
   assert.equal((await call('auth/register',{...input,role:'COMPANY_ADMIN'})).status,400);
   const registered=await call('auth/register',input); assert.equal(registered.status,201);
   const access=registered.body.accessToken; const firstRefresh=jar.sr_refresh;
   assert.match(registered.cookies[0],/HttpOnly/); assert.match(registered.cookies[0],/Path=\/api\/v1\/auth/); assert.match(registered.cookies[0],/Expires=/); assert(!registered.cookies[0].includes('Domain='));
   assert.equal((await call('auth/me',undefined,access)).status,200);
   assert.equal((await call('auth/me')).status,401);
   assert.equal((await call('auth/me',undefined,'malformed')).status,401);
   const user=await db.user.findUniqueOrThrow({where:{normalizedEmail:email}});
   assert.match(user.passwordHash,/^\$argon2id\$/); assert(await verifyPassword(user.passwordHash,password));
   assert(passwordOptions.memoryCost>=19456); assert(!user.passwordHash.includes(password));
   assert.equal(await db.companyMembership.count({where:{userId:user.id}}),1);
   assert.equal((await call('auth/register',input)).status,409);
   assert.equal(await db.company.count(),1);
   assert.equal((await call('auth/login',{email,password:'bad password'})).status,401);
   const unknown=await call('auth/login',{email:`unknown-${prefix}@example.test`,password:'bad password'});
   assert.equal(unknown.status,401); assert.equal(unknown.body.message,'INVALID_CREDENTIALS');
   const session=await db.refreshSession.findUniqueOrThrow({where:{tokenHash:digest(firstRefresh)}});
   for (const spec of [{exp:Math.floor(Date.now()/1000)-1,issuer:security.issuer,audience:security.audience},{exp:Math.floor(Date.now()/1000)+100,issuer:'wrong',audience:security.audience},{exp:Math.floor(Date.now()/1000)+100,issuer:security.issuer,audience:'wrong'}]) {
     const bad=await new SignJWT({sid:session.id}).setProtectedHeader({alg:'HS256',kid:security.config.AUTH_KEY_ID,typ:'JWT'}).setSubject(user.id).setIssuedAt().setIssuer(spec.issuer).setAudience(spec.audience).setExpirationTime(spec.exp).sign(Buffer.from(process.env.AUTH_SIGNING_KEY,'hex'));
     assert.equal((await call('auth/me',undefined,bad)).status,401);
   }
   const refreshed=await call('auth/refresh',{}); assert.equal(refreshed.status,201); assert.notEqual(jar.sr_refresh,firstRefresh);
   assert.equal((await db.refreshSession.findUniqueOrThrow({where:{id:session.id}})).successorId!==null,true);
   const successor=jar.sr_refresh; jar.sr_refresh=firstRefresh;
   assert.equal((await call('auth/refresh',{})).status,401);
   jar.sr_refresh=successor; assert.equal((await call('auth/refresh',{})).status,401);
   assert.equal((await call('auth/me',undefined,refreshed.body.accessToken)).status,401);
   const login=await call('auth/login',{email,password}); assert.equal(login.status,201);
   const raceToken=jar.sr_refresh;
   const race=await Promise.all([call('auth/refresh',{},undefined,{cookies:false}),call('auth/refresh',{},undefined,{cookies:false})]);
   assert.deepEqual(race.map(r=>r.status).sort(),[201,401]);
   const raceSession=await db.refreshSession.findUniqueOrThrow({where:{tokenHash:digest(raceToken)}});
   assert.equal(await db.refreshSession.count({where:{familyId:raceSession.familyId,revokedAt:null}}),0);
   const logged=await call('auth/login',{email,password}); assert.equal(logged.status,201);
   assert.equal((await call('auth/logout',{},logged.body.accessToken)).status,201);
   assert.equal((await call('auth/me',undefined,logged.body.accessToken)).status,401);
   const resetUnknown=await call('auth/reset-request',{email:`nobody-${prefix}@example.test`});
   const resetKnown=await call('auth/reset-request',{email}); assert.deepEqual(resetKnown.body,resetUnknown.body);
   const delivery=await db.authNotificationDelivery.findFirstOrThrow({where:{userId:user.id,status:'PENDING'}});
   assert(delivery.ciphertext); const raw=security.decrypt(delivery.ciphertext,delivery.keyVersion,`AUTH:${delivery.id}`);
   assert(!delivery.ciphertext.includes(raw)); assert.equal(await db.authOutboxEvent.count({where:{deliveryId:delivery.id}}),1);
   assert.throws(()=>security.decrypt(delivery.ciphertext,delivery.keyVersion,'OTHER'));
   const resetResponse=await call('auth/reset',{token:raw,password:'Changed synthetic password 456!'}); assert.equal(resetResponse.status,201);
   assert.equal((await call('auth/reset',{token:raw,password:'Another synthetic password 789!'})).status,401);
   assert.equal((await db.authNotificationDelivery.findUniqueOrThrow({where:{id:delivery.id}})).ciphertext,null);
   // Explicitly test family revocation and expiration via service, avoiding account throttle budget.
   const {AuthService}=load('/app/dist/auth/auth.service'); const auth=app.get(AuthService);
   const fresh=await auth.login({email,password:'Changed synthetic password 456!'});
   const identity=await security.verify(fresh.accessToken);
   await auth.revoke(identity); assert.equal((await call('auth/me',undefined,fresh.accessToken)).status,401);
   const expired=await auth.login({email,password:'Changed synthetic password 456!'});
   const expiredIdentity=await security.verify(expired.accessToken);
   await db.refreshSession.update({where:{id:expiredIdentity.sessionId},data:{createdAt:new Date(Date.now()-20000),expiresAt:new Date(Date.now()-10000)}});
   await assert.rejects(()=>auth.refresh(expired.refreshToken));
   if(process.env.PHASE2_NOTIFICATION_TESTS==='1') await require('/phase2/notification-runner.cjs')({app,load,db,call,infra,security});
   await require('/phase2/consumption-runner.cjs')({app,load,db,call,security});
   // Account throttle: ten attempts in a window, independent of success/existence.
   const throttle=`throttle-${prefix}@example.test`;
   for(let i=0;i<10;i++) assert.equal((await call('auth/login',{email:throttle,password:'invalid'})).status,401);
   assert.equal((await call('auth/login',{email:throttle,password:'invalid'})).status,429);
   const disabled=await auth.login({email,password:'Changed synthetic password 456!'});
   await db.user.update({where:{id:user.id},data:{status:'DISABLED'}});
   assert.equal((await call('auth/me',undefined,disabled.accessToken)).status,401);
   await assert.rejects(()=>auth.login({email,password:'Changed synthetic password 456!'}));
   await db.user.update({where:{id:user.id},data:{status:'ACTIVE'}});
   await auth.requestReset(email);
   const expiring=await db.authNotificationDelivery.findFirstOrThrow({where:{userId:user.id,status:'PENDING'}});
   const expiredRaw=security.decrypt(expiring.ciphertext,expiring.keyVersion,`AUTH:${expiring.id}`);
   await db.passwordResetToken.update({where:{id:expiring.resetTokenId},data:{createdAt:new Date(Date.now()-20000),expiresAt:new Date(Date.now()-10000)}});
   await assert.rejects(()=>auth.reset(expiredRaw,'Another synthetic password 789!'));
   assert.equal((await call('auth/refresh',{},undefined,{headers:{'x-csrf-token':'invalid'}})).status,403);
   const {AuthController}=load('/app/dist/auth/auth.controller'); const controller=app.get(AuthController);
   infra.env.NODE_ENV='production';
   let secured;
   controller.csrf({cookie:(_name,_value,options)=>{secured=options;},setHeader:()=>{}});
   assert.equal(secured.secure,true); assert.equal(secured.httpOnly,true);
   infra.env.NODE_ENV='development';
   let limited=false;
   for(let i=0;i<61;i++) { const response=await call('auth/refresh',{}); if(response.status===429) {limited=true;break;} assert.equal(response.status,401); }
   assert(limited,'IP limit must reject before 61 more attempts');
   if(process.env.PHASE2_TENANT_TESTS==='1') await require('/phase2/tenant-runner.cjs')({app,load,db,call,user,identity});
   const started=Date.now(); await hashPassword('Calibration synthetic only'); console.log(`Argon2id calibration ${Date.now()-started}ms`);
   console.log('PASS authentication HTTP, PostgreSQL rotation/replay race, reset, cookies, CSRF, throttling');
 } finally { await app.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
