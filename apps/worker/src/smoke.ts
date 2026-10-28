import { Queue, QueueEvents } from 'bullmq';
import { readEnvironment } from '@smart-recruit/config';
import { redisOptions } from '@smart-recruit/api/infrastructure';
import { smokeQueue } from './queues/smoke';
async function main() {
  const connection = redisOptions(readEnvironment().REDIS_URL);
  const queue = new Queue(smokeQueue, { connection });
  const events = new QueueEvents(smokeQueue, { connection });
  queue.on('error', () => undefined); events.on('error', () => undefined);
  const deadline = setTimeout(() => { console.error('Queue smoke timed out'); process.exit(1); }, 20000);
  try {
    await events.waitUntilReady();
    const job = await queue.add('ping', {}, { removeOnComplete: 20, removeOnFail: 20, attempts: 1 });
    const result = await job.waitUntilFinished(events, 10000);
    if (result.status !== 'ok') throw new Error('INVALID_RESULT');
    console.log('Queue smoke passed');
  } finally { clearTimeout(deadline); await events.close(); await queue.close(); }
}
main().catch(() => { console.error('Queue smoke failed'); process.exitCode = 1; });
