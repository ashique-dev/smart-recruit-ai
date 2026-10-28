import { Notifications } from '@smart-recruit/api/notifications';
import { NotificationRuntime } from '@smart-recruit/api/notification-runtime';
import { Security } from '@smart-recruit/api/security';
import 'reflect-metadata';
import { createServer } from 'node:http';
import { ConsoleLogger, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { Infrastructure, redisOptions } from '@smart-recruit/api/infrastructure';
import { smokeQueue } from './queues/smoke';
import { processSmoke } from './processors/smoke';
const logger = new ConsoleLogger({ json: true });
@Injectable()
class WorkerRuntime implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker;
  private timer?: NodeJS.Timeout;
  private heartbeatAt = 0;
  private stopping = false;
  private readonly server = createServer((request, response) => {
    if (request.url !== '/health/live' && request.url !== '/health/ready') { response.writeHead(404).end(); return; }
    const ready = !this.stopping && Date.now() - this.heartbeatAt < 20000 && Boolean(this.worker?.isRunning()) && this.notifications.isReady();
    response.writeHead(request.url === '/health/live' || ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: request.url === '/health/live' || ready ? 'ok' : 'unavailable' }));
  });
  constructor(private readonly infrastructure: Infrastructure, private readonly notifications: NotificationRuntime) {}
  async onModuleInit() {
    this.worker = new Worker(smokeQueue, processSmoke, { connection: redisOptions(this.infrastructure.env.REDIS_URL), concurrency: 1 });
    this.worker.on('error', () => logger.warn({ event: 'queue_connection_error' }));
    this.worker.on('failed', () => logger.warn({ event: 'smoke_job_failed' }));
    this.worker.on('completed', () => logger.log({ event: 'smoke_job_completed' }));
    await new Promise<void>(resolve => this.server.listen(this.infrastructure.env.WORKER_PORT, '0.0.0.0', resolve));
    await this.heartbeat();
  }
  private async heartbeat() {
    if (this.stopping) return;
    try {
      await this.infrastructure.databaseReady();
      await this.infrastructure.redis.ping();
      await this.infrastructure.prisma.workerHeartbeat.upsert({ where: { id: 'worker' }, create: { id: 'worker', updatedAt: new Date() }, update: { updatedAt: new Date() } });
      this.heartbeatAt = Date.now();
    } catch { logger.warn({ event: 'worker_dependencies_unavailable' }); }
    if (!this.stopping) this.timer = setTimeout(() => void this.heartbeat(), 5000);
  }
  async onModuleDestroy() {
    this.stopping = true; clearTimeout(this.timer);
    const deadline = setTimeout(() => { logger.error({ event: 'worker_shutdown_timeout' }); process.exit(1); }, 25000);
    deadline.unref();
    await this.worker?.close();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    clearTimeout(deadline);
  }
}
@Module({ providers: [Infrastructure, Security, Notifications, NotificationRuntime, WorkerRuntime] })
class WorkerModule {}
NestFactory.createApplicationContext(WorkerModule, { logger }).then(app => app.enableShutdownHooks())
  .catch(() => { logger.error({ event: 'worker_start_failed' }); process.exitCode = 1; });
