CREATE TYPE "OwnershipPartyType" AS ENUM ('INDIVIDUAL', 'LEGAL_ENTITY', 'GOVERNMENT_ENTITY');
CREATE TYPE "OwnershipPartyRole" AS ENUM ('OWNER', 'DIRECTOR', 'BENEFICIAL_OWNER', 'AUTHORIZED_OFFICIAL');
CREATE TYPE "OwnershipEvidenceType" AS ENUM ('IDENTITY_DOCUMENT', 'SELFIE', 'BUSINESS_REGISTRATION', 'GOVERNMENT_AUTHORITY', 'AUTHORIZATION_LETTER');

ALTER TABLE "organization_compliance"
  ADD COLUMN "ownershipDeclarationAcceptedAt" TIMESTAMPTZ(6),
  ADD COLUMN "ownershipDeclarationAcceptedByUserId" UUID;

ALTER TABLE "tenant_setups"
  ADD COLUMN "activationRequestedAt" TIMESTAMPTZ(6),
  ADD COLUMN "activationReviewedAt" TIMESTAMPTZ(6),
  ADD COLUMN "activationReviewedByUserId" UUID,
  ADD COLUMN "activationReviewReason" VARCHAR(1000);

CREATE TABLE "tenant_ownership_parties" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "partyType" "OwnershipPartyType" NOT NULL,
  "role" "OwnershipPartyRole" NOT NULL,
  "fullName" VARCHAR(250) NOT NULL,
  "registrationNumber" VARCHAR(150),
  "registrationCountry" VARCHAR(100),
  "identityDocumentType" VARCHAR(50),
  "status" "OrganizationIdentityReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "submittedAt" TIMESTAMPTZ(6),
  "reviewedAt" TIMESTAMPTZ(6),
  "reviewedByUserId" UUID,
  "rejectionReason" VARCHAR(1000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tenant_ownership_parties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_ownership_evidence" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "partyId" UUID NOT NULL,
  "evidenceType" "OwnershipEvidenceType" NOT NULL,
  "storageKey" VARCHAR(1000) NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploadedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_ownership_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_ownership_parties_tenantId_status_partyType_role_idx"
  ON "tenant_ownership_parties"("tenantId", "status", "partyType", "role");
CREATE INDEX "tenant_ownership_evidence_tenantId_partyId_evidenceType_createdAt_idx"
  ON "tenant_ownership_evidence"("tenantId", "partyId", "evidenceType", "createdAt");

ALTER TABLE "tenant_ownership_parties"
  ADD CONSTRAINT "tenant_ownership_parties_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tenant_ownership_parties_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tenant_ownership_parties_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_ownership_evidence"
  ADD CONSTRAINT "tenant_ownership_evidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tenant_ownership_evidence_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "tenant_ownership_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "tenant_ownership_evidence_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "tenantId", "scope", "resource", "action", "effect", "description", "status", "createdAt", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000091', NULL, 'PLATFORM', 'tenant_ownership', 'review', 'ALLOW', 'Review tenant ownership identity evidence', 'ACTIVE', NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET
  "scope" = EXCLUDED."scope",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "effect" = EXCLUDED."effect",
  "description" = EXCLUDED."description",
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();

INSERT INTO "role_permissions" ("roleId", "permissionId", "assignedAt")
SELECT role."id", permission."id", NOW()
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."tenantId" IS NULL
  AND role."scope" = 'PLATFORM'
  AND role."status" = 'ACTIVE'
  AND role."code" IN ('PLATFORM_ADMIN', 'PLATFORM_VERIFIER', 'VERIFICATION_REVIEWER')
  AND permission."scope" = 'PLATFORM'
  AND permission."resource" = 'tenant_ownership'
  AND permission."action" = 'review'
  AND permission."effect" = 'ALLOW'
  AND permission."tenantId" IS NULL
  AND permission."status" = 'ACTIVE'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "permissions" ("id", "tenantId", "scope", "resource", "action", "effect", "description", "status", "createdAt", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000092', NULL, 'PLATFORM', 'super_admin', 'review_approvals', 'ALLOW', 'Review platform approval queues for tenant documents, ownership, activation, and patient verification', 'ACTIVE', NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET
  "scope" = EXCLUDED."scope",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "effect" = EXCLUDED."effect",
  "description" = EXCLUDED."description",
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();

INSERT INTO "role_permissions" ("roleId", "permissionId", "assignedAt")
SELECT role."id", permission."id", NOW()
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."tenantId" IS NULL
  AND role."scope" = 'PLATFORM'
  AND role."status" = 'ACTIVE'
  AND role."code" IN ('PLATFORM_ADMIN', 'PLATFORM_VERIFIER', 'VERIFICATION_REVIEWER')
  AND permission."scope" = 'PLATFORM'
  AND permission."resource" = 'super_admin'
  AND permission."action" = 'review_approvals'
  AND permission."effect" = 'ALLOW'
  AND permission."tenantId" IS NULL
  AND permission."status" = 'ACTIVE'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;