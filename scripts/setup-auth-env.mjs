// Add missing Phase 2 keys without printing or replacing existing secrets.
import { readFileSync, appendFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
const existing=parseEnv(readFileSync('.env','utf8'));
const values={AUTH_SIGNING_KEY:randomBytes(32).toString('hex'),CSRF_KEY:randomBytes(32).toString('hex'),NOTIFICATION_ENCRYPTION_KEY:randomBytes(32).toString('hex'),AUTH_KEY_ID:'v1',NOTIFICATION_KEY_VERSION:'v1',SMTP_FROM:'noreply@example.test'};
for (const [key,value] of Object.entries(values)) if (!(key in existing)) appendFileSync('.env',`\n${key}=${value}\n`,{mode:0o600});
console.log('Missing Phase 2 settings added; existing values preserved.');
