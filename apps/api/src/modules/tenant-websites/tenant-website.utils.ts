import { Prisma } from '@prisma/client';

export interface TenantWebsiteFaq {
  question: string;
  answer: string;
}

export interface TenantWebsiteContent {
  tagline: string;
  heroTitle: string;
  heroDescription: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  heroImageUrl: string;
  contactPhone: string;
  contactEmail: string;
  whatsapp: string;
  emergencyPhone: string;
  emergencyMessage: string;
  facebookUrl: string;
  instagramUrl: string;
  linkedinUrl: string;
  seoTitle: string;
  seoDescription: string;
  openGraphTitle: string;
  openGraphDescription: string;
  canonicalUrl: string;
  socialShareImageUrl: string;
  faviconUrl: string;
  googleBusinessProfileUrl: string;
  keywords: string[];
  structuredDataType: 'MedicalClinic' | 'Hospital' | 'DentalClinic' | 'Organization';
  branchIds: string[];
  serviceIds: string[];
  providerIds: string[];
  faqs: TenantWebsiteFaq[];
}

export function createDefaultTenantWebsiteContent(name: string): TenantWebsiteContent {
  return {
    tagline: '',
    heroTitle: name,
    heroDescription: '',
    description: '',
    primaryColor: '#276b52',
    secondaryColor: '#edf5ef',
    logoUrl: '',
    heroImageUrl: '',
    contactPhone: '',
    contactEmail: '',
    whatsapp: '',
    emergencyPhone: '',
    emergencyMessage: '',
    facebookUrl: '',
    instagramUrl: '',
    linkedinUrl: '',
    seoTitle: name,
    seoDescription: '',
    openGraphTitle: name,
    openGraphDescription: '',
    canonicalUrl: '',
    socialShareImageUrl: '',
    faviconUrl: '',
    googleBusinessProfileUrl: '',
    keywords: [],
    structuredDataType: 'MedicalClinic',
    branchIds: [],
    serviceIds: [],
    providerIds: [],
    faqs: [],
  };
}

export function websiteSlugBase(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
    .replace(/-+$/g, '');
  return slug || 'healthcare-provider';
}

export async function provisionTenantWebsite(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tenantName: string,
  uniqueSuffix = tenantId,
  actorId?: string,
) {
  const base = websiteSlugBase(tenantName);
  const suffix = `-${websiteSlugBase(uniqueSuffix)}`;
  const slug = `${base.slice(0, 180 - suffix.length)}${suffix}`;
  const website = await tx.tenantWebsite.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      slug,
      draftContent: createDefaultTenantWebsiteContent(tenantName) as unknown as Prisma.InputJsonObject,
    },
  });
  if (actorId) {
    const revision = await tx.tenantWebsiteRevision.createMany({
      data: [{
        websiteId: website.id,
        revision: 1,
        slug: website.slug,
        content: website.draftContent as Prisma.InputJsonObject,
        actorId,
      }],
      skipDuplicates: true,
    });
    if (revision.count > 0) {
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: actorId,
          action: 'TENANT_WEBSITE_PROVISIONED',
          resourceType: 'TENANT_WEBSITE',
          resourceId: website.id,
          outcome: 'SUCCESS',
          metadata: { slug: website.slug, revision: 1 },
        },
      });
    }
  }
  return website;
}

export function parseTenantWebsiteContent(value: Prisma.JsonValue, fallbackName: string): TenantWebsiteContent {
  const defaults = createDefaultTenantWebsiteContent(fallbackName);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;

  const source = value as Record<string, Prisma.JsonValue>;
  const text = (key: keyof TenantWebsiteContent, maxLength: number): string => {
    const field = source[key];
    return typeof field === 'string' ? field.slice(0, maxLength) : defaults[key] as string;
  };
  const idList = (key: 'branchIds' | 'serviceIds' | 'providerIds'): string[] => {
    const field = source[key];
    return Array.isArray(field) ? field.filter((id): id is string => typeof id === 'string') : [];
  };
  const faqs = Array.isArray(source.faqs)
    ? source.faqs
        .filter((item): item is Record<string, Prisma.JsonValue> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
        .filter((item) => typeof item.question === 'string' && typeof item.answer === 'string')
        .slice(0, 20)
        .map((item) => ({
          question: (item.question as string).slice(0, 200),
          answer: (item.answer as string).slice(0, 1000),
        }))
    : [];

  return {
    tagline: text('tagline', 180),
    heroTitle: text('heroTitle', 200),
    heroDescription: text('heroDescription', 1000),
    description: text('description', 2000),
    primaryColor: text('primaryColor', 7),
    secondaryColor: text('secondaryColor', 7),
    logoUrl: text('logoUrl', 1000),
    heroImageUrl: text('heroImageUrl', 1000),
    contactPhone: text('contactPhone', 50),
    contactEmail: text('contactEmail', 320),
    whatsapp: text('whatsapp', 50),
    emergencyPhone: text('emergencyPhone', 50),
    emergencyMessage: text('emergencyMessage', 300),
    facebookUrl: text('facebookUrl', 500),
    instagramUrl: text('instagramUrl', 500),
    linkedinUrl: text('linkedinUrl', 500),
    seoTitle: text('seoTitle', 200),
    seoDescription: text('seoDescription', 320),
    openGraphTitle: text('openGraphTitle', 200),
    openGraphDescription: text('openGraphDescription', 320),
    canonicalUrl: text('canonicalUrl', 1000),
    socialShareImageUrl: text('socialShareImageUrl', 1000),
    faviconUrl: text('faviconUrl', 1000),
    googleBusinessProfileUrl: text('googleBusinessProfileUrl', 1000),
    keywords: Array.isArray(source.keywords) ? source.keywords.filter((keyword): keyword is string => typeof keyword === 'string').slice(0, 20).map((keyword) => keyword.slice(0, 60)) : [],
    structuredDataType: ['MedicalClinic', 'Hospital', 'DentalClinic', 'Organization'].includes(String(source.structuredDataType)) ? source.structuredDataType as TenantWebsiteContent['structuredDataType'] : 'MedicalClinic',
    branchIds: idList('branchIds'),
    serviceIds: idList('serviceIds'),
    providerIds: idList('providerIds'),
    faqs,
  };
}