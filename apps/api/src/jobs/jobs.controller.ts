import { Type } from 'class-transformer';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuthGuard, CsrfGuard, type AuthRequest } from '../auth/guards';
import { JobStatus } from '../../generated/client';
import { PageDto } from '../common/pagination';
import { JobsService } from './jobs.service';
import type { DraftingTask } from '@smart-recruit/ai-contracts';
export class JobDto {
 @ApiProperty() @IsString() @Length(1,200) @Matches(/\S/) title!:string;
 @ApiProperty() @IsString() @Length(1,20000) @Matches(/\S/) description!:string;
 @ApiProperty() @IsString() @Length(0,120) department!:string;
 @ApiProperty() @IsIn(['FULL_TIME','PART_TIME','CONTRACT','TEMPORARY','INTERNSHIP','OTHER']) employmentType!:string;
 @ApiProperty() @IsIn(['ONSITE','HYBRID','REMOTE']) workArrangement!:string;
 @ApiProperty() @IsString() @Length(0,200) location!:string;
 @ApiProperty() @IsArray() @ArrayMaxSize(30) requirements!:unknown[];
}
export class UpdateJobDto extends JobDto {@ApiProperty() @IsInt() @Min(1) revision!:number;}
export class RevisionDto {@ApiProperty() @IsInt() @Min(1) revision!:number;}
export class ApprovalDto extends RevisionDto {@ApiProperty() @IsUUID() idempotencyKey!:string;}
export class RubricPageDto {@ApiProperty({required:false}) @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(2147483647) before?:number;}
export class StatusDto extends RevisionDto {@ApiProperty({enum:JobStatus}) @IsEnum(JobStatus) status!:JobStatus;}
export class DraftDto extends RevisionDto {
 @ApiProperty() @IsArray() @ArrayMaxSize(30) criteria!:unknown[];
 @ApiProperty({required:false}) @IsOptional() @IsUUID() configId?:string;
 @ApiProperty({required:false}) @IsOptional() @IsInt() @Min(1) configRevision?:number;
}
export class RequestDto extends RevisionDto {
 @ApiProperty() @IsIn(['job-analysis','rubric-draft']) task!:DraftingTask;
 @ApiProperty() @IsUUID() idempotencyKey!:string;
}
@ApiTags('Jobs and rubrics') @ApiBearerAuth()
@Controller('companies/:companyId/jobs') @UseGuards(CsrfGuard,AuthGuard)
export class JobsController {
 constructor(private readonly jobs:JobsService){}
 @Get() list(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Query() p:PageDto){return this.jobs.list(r.identity,c,p.after);}
 @Post() create(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Body() b:JobDto){return this.jobs.create(r.identity,c,b);}
 @Get(':id') get(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Param('id',new ParseUUIDPipe()) id:string){return this.jobs.get(r.identity,c,id);}
 @Get(':id/rubrics') history(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Param('id',new ParseUUIDPipe()) id:string,@Query() p:RubricPageDto){return this.jobs.history(r.identity,c,id,p.before);}
 @Get(':id/rubrics/:configId') rubric(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Param('id',new ParseUUIDPipe()) id:string,@Param('configId',new ParseUUIDPipe()) configId:string){return this.jobs.rubric(r.identity,c,id,configId);}
 @Post(':id') update(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:UpdateJobDto){const {revision,...body}=b;return this.jobs.update(r.identity,c,id,body,revision);}
 @Post(':id/status') status(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:StatusDto){return this.jobs.status(r.identity,c,id,b.status,b.revision);}
 @Post(':id/drafts') draft(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:DraftDto){return this.jobs.draft(r.identity,c,id,b.criteria,b.revision,b.configId,b.configRevision);}
 @Post(':id/rubrics/:configId/approve') approve(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Param('id',new ParseUUIDPipe()) id:string,@Param('configId',new ParseUUIDPipe()) configId:string,@Body() b:ApprovalDto){return this.jobs.approve(r.identity,c,id,configId,b.revision,b.idempotencyKey);}
 @Post(':id/ai') request(@Req() r:AuthRequest,@Param('companyId',new ParseUUIDPipe()) c:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:RequestDto){return this.jobs.request(r.identity,c,id,b.task,b.idempotencyKey,b.revision);}
}
