CREATE TYPE "public"."TenantWebsiteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');
CREATE TYPE "public"."TenantWebsiteEnquiryStatus" AS ENUM ('NEW', 'READ', 'RESOLVED');

CREATE TABLE "public"."tenant_websites" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "status" "public"."TenantWebsiteStatus" NOT NULL DEFAULT 'DRAFT',
    "draftContent" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "publishedContent" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedRevision" INTEGER,
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_websites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."tenant_website_enquiries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(50),
    "message" VARCHAR(3000) NOT NULL,
    "status" "public"."TenantWebsiteEnquiryStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_website_enquiries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."tenant_website_revisions" (
    "id" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "content" JSONB NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_website_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_websites_tenantId_key" ON "public"."tenant_websites"("tenantId");
CREATE UNIQUE INDEX "tenant_websites_tenantId_id_key" ON "public"."tenant_websites"("tenantId", "id");
CREATE UNIQUE INDEX "tenant_websites_slug_key" ON "public"."tenant_websites"("slug");
CREATE INDEX "tenant_websites_status_slug_idx" ON "public"."tenant_websites"("status", "slug");
CREATE INDEX "tenant_website_enquiries_tenantId_status_createdAt_idx" ON "public"."tenant_website_enquiries"("tenantId", "status", "createdAt");
CREATE UNIQUE INDEX "tenant_website_revisions_websiteId_revision_key" ON "public"."tenant_website_revisions"("websiteId", "revision");
CREATE INDEX "tenant_website_revisions_websiteId_createdAt_idx" ON "public"."tenant_website_revisions"("websiteId", "createdAt");

ALTER TABLE "public"."tenant_websites"
ADD CONSTRAINT "tenant_websites_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."tenant_website_enquiries"
ADD CONSTRAINT "tenant_website_enquiries_tenantId_websiteId_fkey"
FOREIGN KEY ("tenantId", "websiteId") REFERENCES "public"."tenant_websites"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."tenant_website_revisions"
ADD CONSTRAINT "tenant_website_revisions_websiteId_fkey"
FOREIGN KEY ("websiteId") REFERENCES "public"."tenant_websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;