-- Add recurring appointment series without modifying existing appointment data.
CREATE TYPE "public"."AppointmentSeriesStatus" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
  'COMPLETED'
);

CREATE TABLE "public"."appointment_series" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "patientTenantRecordId" UUID NOT NULL,
  "providerId" UUID,
  "branchId" UUID,
  "departmentId" UUID,
  "serviceId" UUID,
  "createdByUserId" UUID NOT NULL,
  "timeZone" VARCHAR(100) NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "maxOccurrences" INTEGER,
  "generatedThrough" DATE,
  "weekdays" INTEGER[] NOT NULL,
  "intervalWeeks" INTEGER NOT NULL DEFAULT 1,
  "startMinute" INTEGER NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "reason" VARCHAR(1000),
  "patientNotes" VARCHAR(2000),
  "status" "public"."AppointmentSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "appointment_series_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_series_tenantId_id_key" UNIQUE ("tenantId", "id")
);

-- Nullable seriesId preserves existing one-off appointments.
ALTER TABLE "public"."appointments"
  ADD COLUMN "seriesId" UUID;

CREATE UNIQUE INDEX "appointments_tenantId_seriesId_startAt_key"
  ON "public"."appointments" ("tenantId", "seriesId", "startAt");

CREATE INDEX "appointment_series_tenantId_status_startDate_idx"
  ON "public"."appointment_series" ("tenantId", "status", "startDate");

CREATE INDEX "appointment_series_tenantId_patientTenantRecordId_status_idx"
  ON "public"."appointment_series" ("tenantId", "patientTenantRecordId", "status");

ALTER TABLE "public"."appointment_series"
  ADD CONSTRAINT "appointment_series_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_series"
  ADD CONSTRAINT "appointment_series_patientTenantRecordId_fkey"
  FOREIGN KEY ("patientTenantRecordId") REFERENCES "public"."patient_tenant_records"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_series"
  ADD CONSTRAINT "appointment_series_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "public"."provider_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_series"
  ADD CONSTRAINT "appointment_series_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "public"."branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_series"
  ADD CONSTRAINT "appointment_series_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "public"."departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_series"
  ADD CONSTRAINT "appointment_series_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "public"."services"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_series"
  ADD CONSTRAINT "appointment_series_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointments"
  ADD CONSTRAINT "appointments_tenantId_seriesId_fkey"
  FOREIGN KEY ("tenantId", "seriesId")
  REFERENCES "public"."appointment_series"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
