import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@smart-recruit/shared';
import { Infrastructure } from './infrastructure';
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly infrastructure: Infrastructure) {}
  @Get('live') live(): HealthResponse { return { status: 'ok' }; }
  @Get('ready') async ready(): Promise<HealthResponse> {
    const result = await this.infrastructure.health();
    if (result.status === 'unavailable') throw new ServiceUnavailableException(result);
    return result;
  }
}
