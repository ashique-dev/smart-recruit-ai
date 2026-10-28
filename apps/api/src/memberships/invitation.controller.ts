import { PageDto } from '../common/pagination';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsString, IsUUID, Length, Matches } from 'class-validator';
import { CompanyRole } from '../../generated/client';
import { EmailDto } from '../auth/dto';
import { AuthGuard, AuthRateGuard, CsrfGuard, type AuthRequest } from '../auth/guards';
import { InvitationService } from './invitation.service';
export class InviteDto extends EmailDto {
 @ApiProperty({enum:CompanyRole}) @IsEnum(CompanyRole) role!:CompanyRole;
 @ApiProperty() @IsUUID() idempotencyKey!:string;
}
export class ResendDto { @ApiProperty() @IsUUID() idempotencyKey!:string; }
export class AcceptDto {
 @ApiProperty() @Matches(/^[A-Za-z0-9_-]{43}$/) token!:string;
}
export class NewAcceptDto extends AcceptDto {
 @ApiProperty() @IsString() @Length(12,128) password!:string;
 @ApiProperty() @IsString() @Length(1,100) @Matches(/\S/) displayName!:string;
}
@ApiTags('Team invitations') @Controller('companies/:companyId/invitations') @UseGuards(CsrfGuard,AuthGuard)
export class InvitationController {
 constructor(private readonly invitations:InvitationService) {}
 @Get() list(@Req() req:AuthRequest,@Param('companyId',new ParseUUIDPipe()) companyId:string,@Query() page:PageDto) {return this.invitations.list(req.identity,companyId,page.after);}
 @Post() create(@Req() req:AuthRequest,@Param('companyId',new ParseUUIDPipe()) companyId:string,@Body() body:InviteDto) {return this.invitations.create(req.identity,companyId,body.email,body.role,body.idempotencyKey);}
 @Post(':id/resend') resend(@Req() req:AuthRequest,@Param('companyId',new ParseUUIDPipe()) companyId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:ResendDto) {return this.invitations.resend(req.identity,companyId,id,body.idempotencyKey);}
 @Post(':id/revoke') revoke(@Req() req:AuthRequest,@Param('companyId',new ParseUUIDPipe()) companyId:string,@Param('id',new ParseUUIDPipe()) id:string) {return this.invitations.revoke(req.identity,companyId,id);}
}
@ApiTags('Team acceptance') @Controller('invitations') @UseGuards(CsrfGuard,AuthRateGuard)
export class AcceptanceController {
 constructor(private readonly invitations:InvitationService) {}
 @Post('accept') @UseGuards(AuthGuard)
 accept(@Req() req:AuthRequest,@Body() body:AcceptDto) {return this.invitations.accept(body.token,req.identity);}
 @Post('accept-new')
 newAccount(@Body() body:NewAcceptDto) {return this.invitations.accept(body.token,undefined,body.password,body.displayName);}
}
