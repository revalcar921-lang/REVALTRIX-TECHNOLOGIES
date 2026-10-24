import { Module } from '@nestjs/common';
import { EmailModule } from '../communication/email/email.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CoreModule } from '../core/core.module.js';
import { VerificationController } from './verification.controller.js';
import { PatientVerificationController } from './patient-verification.controller.js';
import { ManagementLoginVerificationController } from './management-login-verification.controller.js';
import { VerificationService } from './verification.service.js';
import { RegistrationSessionGuard } from '../registration/guards/registration-session.guard.js';

@Module({
  imports: [EmailModule, AuthorizationModule, CoreModule],
  controllers: [VerificationController, PatientVerificationController, ManagementLoginVerificationController],
  providers: [
    VerificationService,
    RegistrationSessionGuard,
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
