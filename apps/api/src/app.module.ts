import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration.js';
import authenticationConfiguration from './config/authentication.configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { CoreModule } from './modules/core/core.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { RegistrationModule } from './modules/registration/registration.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { BranchesModule } from './modules/branches/branches.module.js';
import { DepartmentsModule } from './modules/departments/departments.module.js';
import { TenantSetupModule } from './modules/tenant-setup/tenant-setup.module.js';
import { ServicesModule } from './modules/services/services.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { RegistrationDashboardModule } from './modules/registration-dashboard/registration-dashboard.module.js';
import { VerificationModule } from './modules/verification/verification.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { PatientsModule } from './modules/patients/patients.module.js';
import { PatientDataModule } from './modules/patient-data/patient-data.module.js';
import { PatientFamilyModule } from './modules/patient-family/patient-family.module.js';
import { ProvidersModule } from './modules/providers/providers.module.js';
import { EncountersModule } from './modules/encounters/encounters.module.js';
import { AppointmentsModule } from './modules/appointments/appointments.module.js';
import { TenantFeaturesModule } from './modules/tenant-features/tenant-features.module.js';
import { ShopModule } from './modules/shop/shop.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { ClinicalNotesModule } from './modules/clinical-notes/clinical-notes.module.js';
import { QueuesModule } from './modules/queues/queues.module.js';
import { PatientJourneysModule } from './modules/patient-journeys/patient-journeys.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { StaffModule } from './modules/staff/staff.module.js';
import { TenantWebsitesModule } from './modules/tenant-websites/tenant-websites.module.js';
const envFilePath = [
  resolve(process.cwd(), 'apps/.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
].find((filePath) => existsSync(filePath));

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePath ? [envFilePath] : [],
      load: [configuration, authenticationConfiguration],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 100,
      },
    ]),
    DatabaseModule,
    StorageModule,
    CoreModule,
    HealthModule,
    RegistrationModule,
    OnboardingModule,
    RegistrationDashboardModule,
    TenantSetupModule,
    ServicesModule,
    OrganizationModule,
    VerificationModule,
    AuthorizationModule,
    PatientsModule,
    PatientDataModule,
    PatientFamilyModule,
    ProvidersModule,
    EncountersModule,
    AppointmentsModule,
    TenantFeaturesModule,
    ShopModule,
    ClinicalNotesModule,
    QueuesModule,
    PatientJourneysModule,
    NotificationsModule,
    DashboardModule,
    BranchesModule,
    DepartmentsModule,
    StaffModule,
    TenantWebsitesModule,
  ],
})
export class AppModule {}
