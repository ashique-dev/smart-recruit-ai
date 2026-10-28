import type { Job } from 'bullmq';
export async function processSmoke(job: Job): Promise<{ status: 'ok' }> {
  if (job.name !== 'ping' || Object.keys(job.data).length !== 0) throw new Error('INVALID_SMOKE_JOB');
  return { status: 'ok' };
}
