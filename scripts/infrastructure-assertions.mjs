export const expectedServices = ['api', 'mailpit', 'minio', 'minio-init', 'nginx', 'postgres', 'redis', 'web', 'worker'];

// These helpers are also injected into the container probe verbatim and regression-tested.
export async function expectPostgresPermissionDenied(operation) {
  try { await operation(); }
  catch (error) {
    if (error.code === 'P2010' && error.meta?.code === '42501') return;
    throw new Error(`Expected PostgreSQL 42501; received ${error.code ?? 'unknown'}/${error.meta?.code ?? 'unknown'}`, { cause: error });
  }
  throw new Error('Forbidden database operation unexpectedly succeeded');
}
export async function expectS3AccessDenied(operation) {
  try { await operation(); }
  catch (error) {
    if (error.code === 'AccessDenied') return;
    throw new Error(`Expected S3 AccessDenied; received ${error.code ?? 'unknown'}`, { cause: error });
  }
  throw new Error('Forbidden storage operation unexpectedly succeeded');
}
export function assertCompleteServices(states) {
  const actual = states.map(state => state.Service).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedServices)) {
    throw new Error(`Expected exactly nine services; received ${actual.join(', ')}`);
  }
  for (const state of states) {
    if (state.Service === 'minio-init') {
      if (state.State !== 'exited' || state.ExitCode !== 0) throw new Error('minio-init must exit successfully');
    } else if (state.State !== 'running' || state.Health !== 'healthy') {
      throw new Error(`${state.Service} must be running and healthy`);
    }
  }
}
export function isNewHeartbeat(before, after) {
  const previous = Date.parse(before);
  const current = Date.parse(after);
  return Number.isFinite(previous) && Number.isFinite(current) && current > previous;
}
export async function pollUntil(check, { timeoutMs = 30000, intervalMs = 1000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await check()) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  } while (Date.now() <= deadline);
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
}
