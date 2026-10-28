import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createConnection } from 'node:net';
import { Agent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { PrismaClient } from '../../generated/client';
import Redis from 'ioredis';
import { Client } from 'minio';
import { readEnvironment } from '@smart-recruit/config';
import { INFRASTRUCTURE_SCHEMA_VERSION, type HealthResponse } from '@smart-recruit/shared';

export function redisOptions(url: string) {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: Number(parsed.port || 6379),
    username: decodeURIComponent(parsed.username) || undefined,
    password: decodeURIComponent(parsed.password), db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    connectTimeout: 3000, maxRetriesPerRequest: null,
  };
}
@Injectable()
export class Infrastructure implements OnModuleDestroy {
  readonly env = readEnvironment();
  readonly prisma = new PrismaClient({ log: [] });
  readonly redis = new Redis(this.env.REDIS_URL, { connectTimeout: 2000, commandTimeout: 2000, maxRetriesPerRequest: 1 });
  readonly storage: Client;
  constructor() {
    this.redis.on('error', () => { /* Health exposes safe component status; never log connection URLs. */ });
    const url = new URL(this.env.S3_ENDPOINT);
    this.storage = new Client({ endPoint: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      useSSL: url.protocol === 'https:', region: this.env.S3_REGION,
      accessKey: this.env.S3_ACCESS_KEY, secretKey: this.env.S3_SECRET_KEY,
      transportAgent: url.protocol === 'https:' ? new HttpsAgent({ timeout: 2000 }) : new Agent({ timeout: 2000 }),
    });
  }
  async databaseReady(): Promise<void> {
    const state = await this.prisma.infrastructureState.findUnique({ where: { id: 1 } });
    if (state?.version !== INFRASTRUCTURE_SCHEMA_VERSION) throw new Error('SCHEMA_VERSION_MISMATCH');
  }
  async smtpReady(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: this.env.SMTP_HOST, port: this.env.SMTP_PORT });
      socket.setTimeout(2000);
      socket.once('data', data => { socket.destroy(); if (data.toString().startsWith('220')) resolve(); else reject(new Error('SMTP_UNAVAILABLE')); });
      socket.once('error', () => reject(new Error('SMTP_UNAVAILABLE')));
      socket.once('timeout', () => { socket.destroy(); reject(new Error('SMTP_UNAVAILABLE')); });
    });
  }
  async health(): Promise<HealthResponse> {
    const checks = { postgres: () => this.databaseReady(), redis: () => this.redis.ping(),
      storage: async () => { if (!await this.storage.bucketExists(this.env.S3_BUCKET)) throw new Error('BUCKET_MISSING'); },
      smtp: () => this.smtpReady() };
    const entries = await Promise.all(Object.entries(checks).map(async ([name, check]) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([check(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 3000); })]);
        return [name, 'up'] as const;
      } catch { return [name, 'down'] as const; }
      finally { clearTimeout(timer); }
    }));
    const components = Object.fromEntries(entries);
    return { status: components.postgres !== 'up' ? 'unavailable' : entries.some(([, status]) => status === 'down') ? 'degraded' : 'ok', components };
  }
  async onModuleDestroy() { this.redis.disconnect(); await this.prisma.$disconnect(); }
}
