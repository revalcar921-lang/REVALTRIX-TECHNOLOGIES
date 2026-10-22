import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CoreModule } from '../core/core.module.js';
import { TenantSetupController } from './tenant-setup.controller.js';
import { TenantSetupService } from './tenant-setup.service.js';
import { AuthenticationModule } from '../core/authentication/authentication.module.js';
import { PatientFamilyModule } from '../patient-family/patient-family.module.js';
import { TenantOwnershipService } from './tenant-ownership.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuthenticationModule, AuthorizationModule, CoreModule, PatientFamilyModule, NotificationsModule],
  controllers: [TenantSetupController],
  providers: [TenantSetupService, TenantOwnershipService],
  exports: [TenantSetupService],
})
export class TenantSetupModule {}
