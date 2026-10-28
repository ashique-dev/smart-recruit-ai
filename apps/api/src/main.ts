import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { readEnvironment } from '@smart-recruit/config';
import { AppModule } from './app.module';
import { logger } from './common/logger';
import { OriginSocketAdapter } from './common/socket.adapter';
async function bootstrap() {
  const env = readEnvironment();
  const app = await NestFactory.create(AppModule, { logger });
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });
  app.useWebSocketAdapter(new OriginSocketAdapter(app, env.CORS_ORIGIN));
  app.use((_req: unknown, res: { setHeader: (key: string, value: string) => void }, next: () => void) => {
    res.setHeader('X-Request-ID', randomUUID()); next();
  });
  if (env.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app,
      new DocumentBuilder().setTitle('SmartRecruit infrastructure').setVersion('1').build()));
  }
  app.enableShutdownHooks();
  await app.listen(env.API_PORT, '0.0.0.0');
}
bootstrap().catch(() => { logger.error({ event: 'api_start_failed' }); process.exitCode = 1; });
