import { test } from 'vitest';
import { createRequire } from 'node:module';
const loadCompiled = createRequire(import.meta.url);
import assert from 'node:assert/strict';
const { readEnvironment } = loadCompiled('../packages/config/dist');
const valid = { PUBLIC_APP_URL: 'http://localhost:8080', CORS_ORIGIN: 'http://localhost:8080', DATABASE_URL: 'postgresql://app:secret@postgres/app', REDIS_URL: 'redis://:secret@redis:6379', S3_ENDPOINT: 'http://minio:9000', S3_BUCKET: 'private-files', S3_ACCESS_KEY: 'app', S3_SECRET_KEY: 'synthetic-test-secret', SMTP_HOST: 'mailpit', AI_PROVIDER: 'mock' };
test('valid explicit development configuration', () => assert.equal(readEnvironment(valid).API_PORT, 3000));
test('missing AI mode fails rather than silently enabling mock', () => assert.throws(() => readEnvironment({ ...valid, AI_PROVIDER: undefined }), /AI_PROVIDER/));
test('invalid ports, wildcard origin and unauthenticated Redis fail', () => {
  for (const change of [{ API_PORT: 0 }, { CORS_ORIGIN: '*' }, { REDIS_URL: 'redis://redis:6379' }]) assert.throws(() => readEnvironment({ ...valid, ...change }));
});
test('configuration errors do not disclose rejected credentials', () => {
  assert.throws(() => readEnvironment({ ...valid, DATABASE_URL: 'sensitive-password' }), error => !error.message.includes('sensitive-password'));
});
test('production rejects insecure origins and mock mode', () => assert.throws(() => readEnvironment({ ...valid, NODE_ENV: 'production' }), /production policy/));
