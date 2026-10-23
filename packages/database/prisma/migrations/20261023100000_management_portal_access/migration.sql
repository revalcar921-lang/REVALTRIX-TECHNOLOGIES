-- Define the platform management portal permission.
-- Intentionally do not assign this permission to any role.
INSERT INTO "permissions"
  ("id", "tenantId", "scope", "resource", "action", "effect", "description", "status", "createdAt", "updatedAt")
VALUES
  ('00000000-0000-4000-8000-000000000093', NULL, 'PLATFORM', 'management_portal', 'access', 'ALLOW', 'Access the Revaltrix internal management portal', 'ACTIVE', NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET
  "tenantId" = EXCLUDED."tenantId",
  "scope" = EXCLUDED."scope",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "effect" = EXCLUDED."effect",
  "description" = EXCLUDED."description",
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();
