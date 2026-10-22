# Tenant Ownership Verification

Tenant ownership verification is stored per tenant; it does not globally verify a person or organization. Each tenant declares exactly one accountable owner party:

- An individual owner submits an identity document and selfie.
- A company/legal-entity owner submits its registration document and adds at least one director or beneficial owner. Each declared individual submits an identity document and selfie.
- A government-owned facility submits a government authority/ownership document and adds at least one authorized official. Each declared official submits an identity document and selfie.

The tenant administrator submits an accuracy declaration. Uploads are privately stored and checked for size, MIME type, and file signature. These checks do not establish document authenticity. Only a platform reviewer with `tenant_ownership:review` can access evidence or approve/reject a party; evidence access and decisions require step-up authentication and are audited. Readiness completes only when every declared party is verified.

This workflow is introduced by migration `20261022130000_tenant_ownership_verification`. Generate the Prisma client and deploy the migration through the normal database release process before using the ownership page. No migration is applied automatically.