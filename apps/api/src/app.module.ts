import { Infrastructure } from './common/infrastructure';
import { Module } from '@nestjs/common';
import { HealthController } from './common/health.controller';
import { InfrastructureGateway } from './common/infrastructure.gateway';
@Module({ controllers: [HealthController], providers: [InfrastructureGateway, Infrastructure] })
export class AppModule {}
