import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
export class PageDto { @ApiPropertyOptional() @IsOptional() @IsUUID() after?:string; }
