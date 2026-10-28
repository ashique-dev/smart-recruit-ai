import { test } from 'vitest';
import { createRequire } from 'node:module';
const loadCompiled = createRequire(import.meta.url);
import assert from 'node:assert/strict';
const { processSmoke } = loadCompiled('../apps/worker/dist/processors/smoke');
test('smoke processor accepts only empty ping jobs', async () => {
  assert.deepEqual(await processSmoke({ name: 'ping', data: {} }), { status: 'ok' });
  await assert.rejects(processSmoke({ name: 'other', data: {} }));
  await assert.rejects(processSmoke({ name: 'ping', data: { unexpected: 'payload' } }));
});
