import { test } from 'vitest';
import { createRequire } from 'node:module';
const loadCompiled = createRequire(import.meta.url);
import assert from 'node:assert/strict';
const { HealthController } = loadCompiled('../apps/api/dist/common/health.controller');
test('liveness is independent of external services', () => assert.deepEqual(new HealthController().live(), { status: 'ok' }));
test('database failure makes readiness unavailable', async () => {
  const controller = new HealthController({ health: async () => ({ status: 'unavailable', components: { postgres: 'down' } }) });
  await assert.rejects(controller.ready(), error => error.getStatus() === 503);
});
test('optional dependency failure exposes degradation without hiding healthy DB', async () => {
  const controller = new HealthController({ health: async () => ({ status: 'degraded', components: { postgres: 'up', redis: 'down' } }) });
  assert.equal((await controller.ready()).status, 'degraded');
});
test('compiled Nest controller retains constructor metadata for dependency injection', () => {
  const { Infrastructure } = loadCompiled('../apps/api/dist/common/infrastructure');
  assert.deepEqual(Reflect.getMetadata('design:paramtypes', HealthController), [Infrastructure]);
});
