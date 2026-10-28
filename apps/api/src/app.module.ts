import { InvitationController, AcceptanceController } from './memberships/invitation.controller';
import { InvitationService } from './memberships/invitation.service';
import { CompanyController } from './companies/company.controller';
import { CompanyService } from './companies/company.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { Security } from './auth/security';
import { AuthGuard, CsrfGuard, AuthRateGuard } from './auth/guards';
import { Infrastructure } from './common/infrastructure';
import { Module } from '@nestjs/common';
import { HealthController } from './common/health.controller';
import { InfrastructureGateway } from './common/infrastructure.gateway';
@Module({ controllers: [HealthController, AuthController, CompanyController, InvitationController, AcceptanceController], providers: [InfrastructureGateway, Infrastructure, Security, AuthService, AuthGuard, CsrfGuard, AuthRateGuard, CompanyService, InvitationService] })
export class AppModule {}
