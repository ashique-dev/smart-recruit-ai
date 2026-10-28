import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
const load=createRequire(import.meta.url);
const {Security,securityConfig,token,digest,normalizeEmail}=load('../../apps/api/dist/auth/security');
function configure() {
 Object.assign(process.env,{AUTH_SIGNING_KEY:randomBytes(32).toString('hex'),CSRF_KEY:randomBytes(32).toString('hex'),NOTIFICATION_ENCRYPTION_KEY:randomBytes(32).toString('hex'),AUTH_KEY_ID:'v1',NOTIFICATION_KEY_VERSION:'v1',SMTP_FROM:'test@example.test'});
 return new Security();
}
test('security keys fail closed without leaking rejected values',()=>{
 assert.throws(()=>securityConfig({AUTH_SIGNING_KEY:'sensitive'}),error=>!error.message.includes('sensitive'));
 const security=configure(); assert.throws(()=>securityConfig({...process.env,CSRF_KEY:security.config.AUTH_SIGNING_KEY}));
});
test('CSRF signature, time bound and ciphertext context/key binding',()=>{
 const security=configure(); const csrf=security.csrf(); assert(security.checkCsrf(csrf)); assert(!security.checkCsrf(`${csrf}x`));
 const past=`${token()}.${Date.now()-3600001}`; assert(!security.checkCsrf(`${past}.${security.mac(past)}`));
 const raw=token(); const sealed=security.encrypt(raw,'AUTH:one'); assert.equal(security.decrypt(sealed.ciphertext,sealed.keyVersion,'AUTH:one'),raw);
 assert.throws(()=>security.decrypt(sealed.ciphertext,sealed.keyVersion,'TENANT:two'));
 assert.throws(()=>security.decrypt(sealed.ciphertext,'unknown','AUTH:one'));
 assert.match(digest(raw),/^[a-f0-9]{64}$/); assert.equal(normalizeEmail(' A+tag@EXAMPLE.test '),'a+tag@example.test');
});
test('access tokens verify signatures and bind staff user/session',async()=>{
 const security=configure(); const userId=randomUUID(); const sessionId=randomUUID(); const access=await security.access(userId,sessionId);
 assert.deepEqual(await security.verify(access),{userId,sessionId});
 await assert.rejects(()=>security.verify(`${access.slice(0,-8)}AAAAAAAA`));
 await assert.rejects(()=>configure().verify(access));
});
