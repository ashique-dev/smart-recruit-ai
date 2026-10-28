import { PageDto } from '../common/pagination';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Length, Matches, Min } from 'class-validator';
import { CompanyRole, MembershipStatus } from '../../generated/client';
import { AuthGuard, CsrfGuard, type AuthRequest } from '../auth/guards';
import { CompanyService } from './company.service';
export class CompanyDto {
 @ApiProperty() @IsString() @Length(1,120) @Matches(/\S/) name!:string;
}
export class SettingsDto extends CompanyDto { @ApiProperty() @IsInt() @Min(1) revision!:number; }
export class MemberDto {
 @ApiProperty({enum:CompanyRole}) @IsEnum(CompanyRole) role!:CompanyRole;
 @ApiProperty({enum:MembershipStatus}) @IsEnum(MembershipStatus) status!:MembershipStatus;
 @ApiProperty() @IsInt() @Min(1) revision!:number;
}
@ApiTags('Companies') @ApiBearerAuth()
@Controller('companies') @UseGuards(CsrfGuard,AuthGuard)
export class CompanyController {
 constructor(private readonly companies:CompanyService) {}
 @Get() list(@Req() req:AuthRequest,@Query() page:PageDto) {return this.companies.list(req.identity,page.after);}
 @Post() create(@Req() req:AuthRequest,@Body() body:CompanyDto) {return this.companies.create(req.identity,body.name);}
 @Get(':companyId') get(@Req() req:AuthRequest,@Param('companyId',new ParseUUIDPipe()) companyId:string) {return this.companies.get(req.identity,companyId);}
 @Post(':companyId/settings') settings(@Req() req:AuthRequest,@Param('companyId',new ParseUUIDPipe()) companyId:string,@Body() body:SettingsDto) {return this.companies.settings(req.identity,companyId,body.name,body.revision);}
 @Get(':companyId/members') team(@Req() req:AuthRequest,@Param('companyId',new ParseUUIDPipe()) companyId:string,@Query() page:PageDto) {return this.companies.team(req.identity,companyId,page.after);}
 @Post(':companyId/members/:memberId') member(@Req() req:AuthRequest,@Param('companyId',new ParseUUIDPipe()) companyId:string,@Param('memberId',new ParseUUIDPipe()) memberId:string,@Body() body:MemberDto) {return this.companies.member(req.identity,companyId,memberId,body.role,body.status,body.revision);}
}
