CREATE TYPE "public"."AppointmentSlotHoldStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'RELEASED');
CREATE TYPE "public"."AppointmentPaymentIntentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'RECONCILIATION_REQUIRED');
CREATE TYPE "public"."AppointmentRefundStatus" AS ENUM ('ELIGIBLE', 'REQUESTED', 'PENDING', 'REFUNDED', 'FAILED', 'DISPUTED', 'NOT_ELIGIBLE');
CREATE TYPE "public"."AppointmentRefundMethod" AS ENUM ('CASH', 'MPESA', 'BANK_TRANSFER', 'OTHER');
CREATE TYPE "public"."AppointmentPaymentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'UNMATCHED', 'REJECTED', 'RECONCILIATION_REQUIRED');

CREATE TABLE "public"."appointment_slot_holds" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "patientTenantRecordId" UUID NOT NULL,
  "providerId" UUID NOT NULL,
  "branchId" UUID,
  "departmentId" UUID,
  "serviceId" UUID NOT NULL,
  "startAt" TIMESTAMPTZ(6) NOT NULL,
  "endAt" TIMESTAMPTZ(6) NOT NULL,
  "timeZone" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(1000),
  "status" "public"."AppointmentSlotHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "appointment_slot_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_slot_holds_start_end_check" CHECK ("endAt" > "startAt")
);

CREATE TABLE "public"."appointment_payment_intents" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "patientTenantRecordId" UUID NOT NULL,
  "slotHoldId" UUID NOT NULL,
  "appointmentId" UUID,
  "internalReference" VARCHAR(100) NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "merchantRequestId" VARCHAR(100),
  "checkoutRequestId" VARCHAR(100),
  "phoneNumber" VARCHAR(20) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL DEFAULT 100.00,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "status" "public"."AppointmentPaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
  "providerResultCode" INTEGER,
  "providerResultText" VARCHAR(1000),
  "providerReceipt" VARCHAR(100),
  "paidAt" TIMESTAMPTZ(6),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "appointment_payment_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_payment_intents_amount_currency_check" CHECK ("amount" = 100.00 AND "currency" = 'KES')
);

CREATE TABLE "public"."appointment_payment_events" (
  "id" UUID NOT NULL,
  "paymentIntentId" UUID,
  "eventKey" VARCHAR(220) NOT NULL,
  "checkoutRequestId" VARCHAR(100),
  "resultCode" INTEGER,
  "resultText" VARCHAR(1000),
  "receipt" VARCHAR(100),
  "amount" DECIMAL(12,2),
  "status" "public"."AppointmentPaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "payloadHash" VARCHAR(128) NOT NULL,
  "failureReason" VARCHAR(1000),
  "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(6),
  CONSTRAINT "appointment_payment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."appointment_refunds" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "paymentIntentId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "status" "public"."AppointmentRefundStatus" NOT NULL DEFAULT 'ELIGIBLE',
  "refundMethod" "public"."AppointmentRefundMethod",
  "reason" VARCHAR(1000) NOT NULL,
  "evidenceRef" VARCHAR(500),
  "providerReference" VARCHAR(100),
  "actorUserId" UUID,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "appointment_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_refunds_amount_check" CHECK ("amount" > 0)
);

ALTER TABLE "public"."appointments" ADD COLUMN "slotHoldId" UUID;

CREATE UNIQUE INDEX "appointment_slot_holds_idempotencyKey_key" ON "public"."appointment_slot_holds"("idempotencyKey");
CREATE INDEX "appointment_slot_holds_tenantId_providerId_status_expiresAt_startAt_idx" ON "public"."appointment_slot_holds"("tenantId", "providerId", "status", "expiresAt", "startAt");
CREATE INDEX "appointment_slot_holds_patientTenantRecordId_status_expiresAt_idx" ON "public"."appointment_slot_holds"("patientTenantRecordId", "status", "expiresAt");
CREATE INDEX "appointment_slot_holds_expiresAt_status_idx" ON "public"."appointment_slot_holds"("expiresAt", "status");
CREATE UNIQUE INDEX "appointment_slot_holds_one_active_provider_slot_idx" ON "public"."appointment_slot_holds"("tenantId", "providerId", "startAt") WHERE "status" = 'ACTIVE';

CREATE INDEX "appointment_payment_intents_slotHoldId_createdAt_idx" ON "public"."appointment_payment_intents"("slotHoldId", "createdAt");
CREATE UNIQUE INDEX "appointment_payment_intents_appointmentId_key" ON "public"."appointment_payment_intents"("appointmentId");
CREATE UNIQUE INDEX "appointment_payment_intents_internalReference_key" ON "public"."appointment_payment_intents"("internalReference");
CREATE UNIQUE INDEX "appointment_payment_intents_idempotencyKey_key" ON "public"."appointment_payment_intents"("idempotencyKey");
CREATE UNIQUE INDEX "appointment_payment_intents_checkoutRequestId_key" ON "public"."appointment_payment_intents"("checkoutRequestId");
CREATE UNIQUE INDEX "appointment_payment_intents_providerReceipt_key" ON "public"."appointment_payment_intents"("providerReceipt");
CREATE INDEX "appointment_payment_intents_tenantId_status_createdAt_idx" ON "public"."appointment_payment_intents"("tenantId", "status", "createdAt");
CREATE INDEX "appointment_payment_intents_patientTenantRecordId_createdAt_idx" ON "public"."appointment_payment_intents"("patientTenantRecordId", "createdAt");
CREATE INDEX "appointment_payment_intents_expiresAt_status_idx" ON "public"."appointment_payment_intents"("expiresAt", "status");

CREATE UNIQUE INDEX "appointment_payment_events_eventKey_key" ON "public"."appointment_payment_events"("eventKey");
CREATE INDEX "appointment_payment_events_checkoutRequestId_receivedAt_idx" ON "public"."appointment_payment_events"("checkoutRequestId", "receivedAt");
CREATE INDEX "appointment_payment_events_paymentIntentId_receivedAt_idx" ON "public"."appointment_payment_events"("paymentIntentId", "receivedAt");
CREATE INDEX "appointment_payment_events_status_receivedAt_idx" ON "public"."appointment_payment_events"("status", "receivedAt");

CREATE INDEX "appointment_refunds_tenantId_status_createdAt_idx" ON "public"."appointment_refunds"("tenantId", "status", "createdAt");
CREATE INDEX "appointment_refunds_appointmentId_createdAt_idx" ON "public"."appointment_refunds"("appointmentId", "createdAt");
CREATE INDEX "appointment_refunds_paymentIntentId_idx" ON "public"."appointment_refunds"("paymentIntentId");
CREATE UNIQUE INDEX "appointment_refunds_providerReference_key" ON "public"."appointment_refunds"("providerReference");
CREATE UNIQUE INDEX "appointment_refunds_one_active_per_payment_intent_idx"
  ON "public"."appointment_refunds"("paymentIntentId")
  WHERE "status" IN ('ELIGIBLE', 'REQUESTED', 'PENDING', 'DISPUTED');

CREATE UNIQUE INDEX "appointments_slotHoldId_key" ON "public"."appointments"("slotHoldId");

ALTER TABLE "public"."appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_patientTenantRecordId_fkey" FOREIGN KEY ("patientTenantRecordId") REFERENCES "public"."patient_tenant_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_slot_holds" ADD CONSTRAINT "appointment_slot_holds_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_payment_intents" ADD CONSTRAINT "appointment_payment_intents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_payment_intents" ADD CONSTRAINT "appointment_payment_intents_patientTenantRecordId_fkey" FOREIGN KEY ("patientTenantRecordId") REFERENCES "public"."patient_tenant_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_payment_intents" ADD CONSTRAINT "appointment_payment_intents_slotHoldId_fkey" FOREIGN KEY ("slotHoldId") REFERENCES "public"."appointment_slot_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_payment_intents" ADD CONSTRAINT "appointment_payment_intents_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_payment_events" ADD CONSTRAINT "appointment_payment_events_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "public"."appointment_payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointment_refunds" ADD CONSTRAINT "appointment_refunds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_refunds" ADD CONSTRAINT "appointment_refunds_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_refunds" ADD CONSTRAINT "appointment_refunds_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "public"."appointment_payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_refunds" ADD CONSTRAINT "appointment_refunds_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."appointment_refunds" ADD CONSTRAINT "appointment_refunds_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_slotHoldId_fkey" FOREIGN KEY ("slotHoldId") REFERENCES "public"."appointment_slot_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;