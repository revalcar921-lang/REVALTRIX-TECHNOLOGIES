import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  createDefaultTenantWebsiteContent,
  provisionTenantWebsite,
  websiteSlugBase,
} from './tenant-website.utils.js';

test('website slug normalization removes accents and unsafe characters', () => {
  assert.equal(websiteSlugBase('St. Mary\'s Health Centre'), 'st-mary-s-health-centre');
  assert.equal(websiteSlugBase(''), 'healthcare-provider');
});

test('same-name organizations receive deterministic distinct slugs', async () => {
  const createdSlugs: string[] = [];
  const tx = {
    tenantWebsite: {
      upsert: async ({ create }: { create: { slug: string } }) => {
        createdSlugs.push(create.slug);
        return {
          id: `website-${createdSlugs.length}`,
          slug: create.slug,
          draftContent: createDefaultTenantWebsiteContent('Green Valley Clinic'),
        };
      },
    },
    tenantWebsiteRevision: { createMany: async () => ({ count: 0 }) },
  } as unknown as Prisma.TransactionClient;

  await provisionTenantWebsite(tx, 'tenant-a', 'Green Valley Clinic', 'GVC-01');
  await provisionTenantWebsite(tx, 'tenant-b', 'Green Valley Clinic', 'GVC-02');

  assert.deepEqual(createdSlugs, ['green-valley-clinic-gvc-01', 'green-valley-clinic-gvc-02']);
  assert.notEqual(createdSlugs[0], createdSlugs[1]);
});

test('provisioning is keyed by tenant and retries the initial revision safely', async () => {
  const upserts: Array<{ where: { tenantId: string }; update: object }> = [];
  const revisions: Array<{ data: Array<{ revision: number }>; skipDuplicates: boolean }> = [];
  const tx = {
    tenantWebsite: {
      upsert: async (args: { where: { tenantId: string }; update: object; create: { slug: string } }) => {
        upserts.push({ where: args.where, update: args.update });
        return {
          id: 'website-id',
          slug: args.create.slug,
          draftContent: createDefaultTenantWebsiteContent('Harbor Medical'),
        };
      },
    },
    tenantWebsiteRevision: {
      createMany: async (args: { data: Array<{ revision: number }>; skipDuplicates: boolean }) => {
        revisions.push(args);
        return { count: 1 };
      },
    },
    auditEvent: { create: async () => ({ id: 'audit-id' }) },
  } as unknown as Prisma.TransactionClient;

  await provisionTenantWebsite(tx, 'tenant-id', 'Harbor Medical', 'HARBOR-01', 'actor-id');
  await provisionTenantWebsite(tx, 'tenant-id', 'Harbor Medical', 'HARBOR-01', 'actor-id');

  assert.equal(upserts.length, 2);
  assert.deepEqual(upserts[0]?.where, { tenantId: 'tenant-id' });
  assert.deepEqual(upserts[0]?.update, {});
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0]?.data[0]?.revision, 1);
  assert.equal(revisions[0]?.skipDuplicates, true);
});