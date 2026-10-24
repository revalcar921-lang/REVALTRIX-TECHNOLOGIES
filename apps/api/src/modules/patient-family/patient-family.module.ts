import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../core/authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { EmailModule } from '../communication/email/email.module.js';
import { PatientFamilyController } from './patient-family.controller.js';
import { FamilyAccessController } from './family-access.controller.js';
import { FamilyAccessGuard } from './family-access.guard.js';
import { FamilyStepUpGuard } from './family-step-up.guard.js';
import { PatientFamilyService } from './patient-family.service.js';
import { FamilyAccessService } from './family-access.service.js';

@Module({
  imports: [AuthenticationModule, AuthorizationModule, EmailModule],
  controllers: [PatientFamilyController, FamilyAccessController],
  providers: [
    PatientFamilyService,
    FamilyAccessService,
    FamilyAccessGuard,
    FamilyStepUpGuard,
  ],
  exports: [
    PatientFamilyService,
    FamilyAccessService,
    FamilyAccessGuard,
    FamilyStepUpGuard,
  ],
})
export class PatientFamilyModule {}
