import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { AuthenticationModule } from '../core/authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { TenantSetupModule } from '../tenant-setup/tenant-setup.module.js';
import { TenantWebsitesController } from './tenant-websites.controller.js';
import { TenantWebsitesService } from './tenant-websites.service.js';

@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    AppointmentsModule,
    TenantSetupModule,
    ThrottlerModule,
  ],
  controllers: [TenantWebsitesController],
  providers: [TenantWebsitesService],
})
export class TenantWebsitesModule {}