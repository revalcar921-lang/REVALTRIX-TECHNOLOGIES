CREATE TYPE "public"."OrganizationIdentityReviewStatus" AS ENUM ('NOT_STARTED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');
CREATE TYPE "public"."ReadinessTestStatus" AS ENUM ('NOT_RUN', 'PASSED', 'FAILED');

ALTER TABLE "public"."tenant_profiles"
  ADD COLUMN "businessType" VARCHAR(100),
  ADD COLUMN "incorporationDate" DATE,
  ADD COLUMN "registrationCountry" VARCHAR(100),
  ADD COLUMN "city" VARCHAR(150),
  ADD COLUMN "latitude" DECIMAL(9,6),
  ADD COLUMN "longitude" DECIMAL(9,6),
  ADD COLUMN "supportEmail" VARCHAR(320),
  ADD COLUMN "whatsappNumber" VARCHAR(50);

CREATE TABLE "public"."organization_compliance" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "ownerIdType" VARCHAR(50),
  "ownerIdDocumentKey" VARCHAR(1000),
  "ownerSelfieKey" VARCHAR(1000),
  "ownerIdentityStatus" "public"."OrganizationIdentityReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "ownerIdentityReviewedAt" TIMESTAMPTZ(6),
  "ownerIdentityReviewedBy" UUID,
  "ownerIdentityRejectionReason" VARCHAR(1000),
  "termsVersion" VARCHAR(50),
  "termsAcceptedAt" TIMESTAMPTZ(6),
  "termsAcceptedByUserId" UUID,
  "termsAcceptanceIp" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "organization_compliance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."booking_policies" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "minLeadTimeMinutes" INTEGER NOT NULL DEFAULT 60,
  "cancellationWindowHours" INTEGER NOT NULL DEFAULT 24,
  "rescheduleWindowHours" INTEGER NOT NULL DEFAULT 12,
  "noShowFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
  "maxBookingsPerDay" INTEGER NOT NULL DEFAULT 10,
  "allowOnlineBooking" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."organization_payment_configs" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "acceptMpesa" BOOLEAN NOT NULL DEFAULT false,
  "acceptCard" BOOLEAN NOT NULL DEFAULT false,
  "acceptBankTransfer" BOOLEAN NOT NULL DEFAULT false,
  "acceptCash" BOOLEAN NOT NULL DEFAULT false,
  "depositRequired" BOOLEAN NOT NULL DEFAULT false,
  "depositPercent" INTEGER,
  "mpesaPaybill" VARCHAR(100),
  "bankAccountName" VARCHAR(200),
  "bankAccountNumber" VARCHAR(100),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "organization_payment_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."operational_resources" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "branchId" UUID,
  "name" VARCHAR(200) NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "operational_resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."readiness_test_runs" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "bookingStatus" "public"."ReadinessTestStatus" NOT NULL DEFAULT 'NOT_RUN',
  "rescheduleStatus" "public"."ReadinessTestStatus" NOT NULL DEFAULT 'NOT_RUN',
  "cancellationStatus" "public"."ReadinessTestStatus" NOT NULL DEFAULT 'NOT_RUN',
  "reminderStatus" "public"."ReadinessTestStatus" NOT NULL DEFAULT 'NOT_RUN',
  "evidenceUrl" VARCHAR(1000),
  "ranByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "readiness_test_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_compliance_tenantId_key" ON "public"."organization_compliance"("tenantId");
CREATE UNIQUE INDEX "booking_policies_tenantId_key" ON "public"."booking_policies"("tenantId");
CREATE UNIQUE INDEX "organization_payment_configs_tenantId_key" ON "public"."organization_payment_configs"("tenantId");
CREATE INDEX "operational_resources_tenantId_isActive_idx" ON "public"."operational_resources"("tenantId", "isActive");
CREATE INDEX "readiness_test_runs_tenantId_createdAt_idx" ON "public"."readiness_test_runs"("tenantId", "createdAt");

ALTER TABLE "public"."organization_compliance"
  ADD CONSTRAINT "organization_compliance_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."booking_policies"
  ADD CONSTRAINT "booking_policies_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."organization_payment_configs"
  ADD CONSTRAINT "organization_payment_configs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."operational_resources"
  ADD CONSTRAINT "operational_resources_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "operational_resources_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "public"."branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."readiness_test_runs"
  ADD CONSTRAINT "readiness_test_runs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;