import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard, AuthRateGuard, type AuthRequest, cookie, CsrfGuard } from './guards';
import { EmailDto, LoginDto, RegisterDto, ResetDto } from './dto';
@ApiTags('Authentication')
@Controller('auth')
@UseGuards(CsrfGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  private options(path: string) {
    return {httpOnly:true,secure:this.auth.infra.env.NODE_ENV==='production',sameSite:'strict' as const,path};
  }
  private reply(result: Awaited<ReturnType<AuthService['login']>>,res: Response) {
    res.cookie('sr_refresh',result.refreshToken,{...this.options('/api/v1/auth'),expires:result.expiresAt});
    res.setHeader('Cache-Control','no-store');
    return {accessToken:result.accessToken};
  }
  @Get('csrf')
  csrf(@Res({passthrough:true}) res: Response, @Req() request?: Request) {
    const previous=request ? cookie(request,'sr_csrf') : '';
    const csrfToken=this.auth.security.checkCsrf(previous) ? previous : this.auth.security.csrf();
    res.cookie('sr_csrf',csrfToken,{...this.options('/api/v1'),maxAge:3600000});
    res.setHeader('Cache-Control','no-store'); return {csrfToken};
  }
  @Post('register') @UseGuards(AuthRateGuard)
  async register(@Body() body:RegisterDto,@Res({passthrough:true}) res:Response) { return this.reply(await this.auth.register(body),res); }
  @Post('login') @UseGuards(AuthRateGuard)
  async login(@Body() body:LoginDto,@Res({passthrough:true}) res:Response) { return this.reply(await this.auth.login(body),res); }
  @Post('refresh') @UseGuards(AuthRateGuard)
  async refresh(@Req() request:Request,@Res({passthrough:true}) res:Response) { return this.reply(await this.auth.refresh(cookie(request,'sr_refresh')),res); }
  @Post('logout') @UseGuards(AuthGuard) @ApiBearerAuth()
  async logout(@Req() request:AuthRequest,@Res({passthrough:true}) res:Response) {
    await this.auth.revoke(request.identity); res.clearCookie('sr_refresh',this.options('/api/v1/auth')); return {ok:true};
  }
  @Get('me') @UseGuards(AuthGuard) @ApiBearerAuth()
  me(@Req() request:AuthRequest) { return this.auth.me(request.identity); }
  @Get('sessions') @UseGuards(AuthGuard) @ApiBearerAuth()
  sessions(@Req() request:AuthRequest) { return this.auth.sessions(request.identity); }
  @Post('sessions/:familyId/revoke') @UseGuards(AuthGuard) @ApiBearerAuth()
  revoke(@Req() request:AuthRequest,@Param('familyId',new ParseUUIDPipe()) id:string) { return this.auth.revoke(request.identity,id); }
  @Post('reset-request') @UseGuards(AuthRateGuard)
  resetRequest(@Body() body:EmailDto) { return this.auth.requestReset(body.email); }
  @Post('reset') @UseGuards(AuthRateGuard)
  reset(@Body() body:ResetDto) { return this.auth.reset(body.token,body.password); }
}
