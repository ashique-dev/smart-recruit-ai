import { test, expect } from 'vitest';
import { expectedServices, expectPostgresPermissionDenied, expectS3AccessDenied, assertCompleteServices, isNewHeartbeat, pollUntil } from '../scripts/infrastructure-assertions.mjs';
const rejectsWith = error => async () => { throw error; };
test('SQL permission probe accepts only Prisma raw-query SQLSTATE 42501', async () => {
  await expect(expectPostgresPermissionDenied(rejectsWith({ code: 'P2010', meta: { code: '42501' } }))).resolves.toBeUndefined();
  for (const error of [{ code: 'P1001' }, { code: 'P2010', meta: { code: '42P01' } }, { code: 'P2010', meta: { code: '42P07' } }, new Error('network')]) {
    await expect(expectPostgresPermissionDenied(rejectsWith(error))).rejects.toThrow('Expected PostgreSQL 42501');
  }
  await expect(expectPostgresPermissionDenied(async () => undefined)).rejects.toThrow('unexpectedly succeeded');
});
test('S3 permission probe rejects transport failures, unrelated S3 errors and success', async () => {
  await expect(expectS3AccessDenied(rejectsWith({ code: 'AccessDenied' }))).resolves.toBeUndefined();
  for (const code of ['ECONNREFUSED', 'NoSuchBucket', 'InvalidAccessKeyId', 'SignatureDoesNotMatch']) {
    await expect(expectS3AccessDenied(rejectsWith({ code }))).rejects.toThrow('Expected S3 AccessDenied');
  }
  await expect(expectS3AccessDenied(async () => undefined)).rejects.toThrow('unexpectedly succeeded');
});
const healthy = () => expectedServices.map(Service => Service === 'minio-init'
  ? { Service, State: 'exited', ExitCode: 0 }
  : { Service, State: 'running', Health: 'healthy' });
test('service verification rejects empty, missing, extra and duplicate services', () => {
  expect(() => assertCompleteServices(healthy())).not.toThrow();
  for (const rows of [[], healthy().slice(1), [...healthy(), healthy()[0]], [...healthy().slice(1), healthy()[1]]]) {
    expect(() => assertCompleteServices(rows)).toThrow('exactly nine services');
  }
});
test('service verification requires successful initializer and running healthy services', () => {
  for (const change of [{ State: 'exited', ExitCode: 1 }, { State: 'running', ExitCode: 0 }]) {
    expect(() => assertCompleteServices(healthy().map(row => row.Service === 'minio-init' ? { ...row, ...change } : row))).toThrow();
  }
  for (const change of [{ State: 'exited' }, { Health: 'unhealthy' }, { Health: '' }]) {
    expect(() => assertCompleteServices(healthy().map(row => row.Service === 'worker' ? { ...row, ...change } : row))).toThrow();
  }
});
test('heartbeat verification requires a strictly newer valid persisted timestamp', () => {
  const before = '2026-10-28T00:00:00.000Z';
  expect(isNewHeartbeat(before, before)).toBe(false);
  expect(isNewHeartbeat(before, '2026-10-27T23:59:59.000Z')).toBe(false);
  expect(isNewHeartbeat(before, 'invalid')).toBe(false);
  expect(isNewHeartbeat(before, '2026-10-28T00:00:01.000Z')).toBe(true);
});
test('recovery polling times out rather than accepting an unchanged heartbeat', async () => {
  await expect(pollUntil(async () => false, { timeoutMs: 10, intervalMs: 1, label: 'new heartbeat' })).rejects.toThrow('new heartbeat');
  let attempts = 0;
  await expect(pollUntil(async () => ++attempts === 2, { timeoutMs: 100, intervalMs: 1 })).resolves.toBeUndefined();
  await expect(pollUntil(rejectsWith(new Error('DB offline')))).rejects.toThrow('DB offline');
});
