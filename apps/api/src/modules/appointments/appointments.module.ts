import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../core/authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { EncountersModule } from '../encounters/encounters.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppointmentDiscoveryController } from './appointment-discovery.controller.js';
import { AppointmentPaymentsController, DarajaAppointmentCallbackController } from './appointment-payments.controller.js';
import { AppointmentPaymentsService } from './appointment-payments.service.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';

@Module({
  imports: [AuthenticationModule, AuthorizationModule, EncountersModule, NotificationsModule, ThrottlerModule],
  controllers: [AppointmentsController, AppointmentDiscoveryController, AppointmentPaymentsController, DarajaAppointmentCallbackController],
  providers: [AppointmentsService, AppointmentPaymentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
