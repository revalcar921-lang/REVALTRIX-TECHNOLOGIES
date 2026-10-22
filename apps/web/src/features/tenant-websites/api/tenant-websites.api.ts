import { apiRequest } from '../../../lib/api.js';
import { authenticatedApiRequest } from '../../../lib/auth-api.js';

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
  faqs: Array<{ question: string; answer: string }>;
}

export interface TenantWebsiteService {
  id: string;
  name: string;
  code?: string;
  description: string | null;
  category?: string | null;
  price: string;
  durationMin: number | null;
  branchId: string | null;
  departmentId?: string | null;
}

export interface TenantWebsiteBranch {
  id: string;
  name: string;
  address: string | null;
  town?: string | null;
  county: string | null;
  contactPhone: string | null;
  contactEmail?: string | null;
  openingTime: string | null;
  closingTime: string | null;
  operatingDays: string[];
}

export interface TenantWebsiteProvider {
  id: string;
  professionalTitle: string | null;
  specialty: string | null;
  user: { displayName: string };
  hasAvailability?: boolean;
}

export interface TenantWebsiteAdminResponse {
  website: {
    id: string;
    slug: string;
    status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
    draftContent: TenantWebsiteContent;
    publishedRevision: number | null;
    revision: number;
    publishedAt: string | null;
    updatedAt: string;
  };
  tenant: {
    id: string;
    name: string;
    type: string;
    profile: {
      description: string | null;
      country: string;
      county: string | null;
      subcounty: string | null;
      address: string | null;
      contactPhone: string | null;
      contactEmail: string | null;
    } | null;
    setup: { status: string; readinessPercent: number } | null;
  };
  branches: TenantWebsiteBranch[];
  services: TenantWebsiteService[];
  providers: TenantWebsiteProvider[];
  revisions: Array<{ id: string; revision: number; slug: string; createdAt: string; actorId: string }>;
  previewUrl: string;
  publicUrl: string | null;
  launchReadiness: { status: string; readinessPercent: number } | null;
}

export interface TenantWebsiteStatus {
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
  slug: string;
  revision: number;
  updatedAt: string;
  publicUrl: string | null;
  previewUrl: string;
}

export interface PublicTenantWebsite {
  slug: string;
  organization: {
    name: string;
    type: string;
    description: string;
    address: string | null;
    town: string | null;
    county: string | null;
    country: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  };
  content: Omit<TenantWebsiteContent, 'branchIds' | 'serviceIds' | 'providerIds'>;
  branches: TenantWebsiteBranch[];
  services: TenantWebsiteService[];
  providers: Array<Omit<TenantWebsiteProvider, 'hasAvailability'>>;
  bookingAvailable: boolean;
}

export interface WebsiteSlot {
  tenantId: string;
  serviceId: string;
  providerId: string;
  providerTitle: string | null;
  specialty: string | null;
  branchId: string | null;
  departmentId: string | null;
  startAt: string;
  endAt: string;
  timeZone: string;
}

export interface WebsiteEnquiry {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  message: string;
  status: 'NEW' | 'READ' | 'RESOLVED';
  createdAt: string;
}

export async function getMyWebsite(): Promise<TenantWebsiteAdminResponse> {
  return authenticatedApiRequest('/v1/tenant-websites/me');
}

export async function getMyWebsiteStatus(): Promise<TenantWebsiteStatus> {
  return authenticatedApiRequest('/v1/tenant-websites/me/status');
}

export async function saveMyWebsite(input: Partial<TenantWebsiteContent> & { slug?: string }) {
  return authenticatedApiRequest<TenantWebsiteAdminResponse>('/v1/tenant-websites/me', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function publishMyWebsite() {
  return authenticatedApiRequest<TenantWebsiteAdminResponse>('/v1/tenant-websites/me/publish', { method: 'POST' });
}

export async function unpublishMyWebsite() {
  return authenticatedApiRequest<TenantWebsiteAdminResponse>('/v1/tenant-websites/me/unpublish', { method: 'POST' });
}

export async function restoreMyWebsiteRevision(revisionId: string) {
  return authenticatedApiRequest<TenantWebsiteAdminResponse>(
    `/v1/tenant-websites/me/revisions/${encodeURIComponent(revisionId)}/restore`,
    { method: 'POST' },
  );
}

export async function getWebsiteEnquiries(): Promise<WebsiteEnquiry[]> {
  return authenticatedApiRequest('/v1/tenant-websites/me/enquiries');
}

export async function setWebsiteEnquiryStatus(enquiryId: string, status: 'READ' | 'RESOLVED') {
  return authenticatedApiRequest(`/v1/tenant-websites/me/enquiries/${encodeURIComponent(enquiryId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function getPublicWebsite(slug: string): Promise<PublicTenantWebsite> {
  return apiRequest(`/v1/tenant-websites/public/${encodeURIComponent(slug)}`);
}

export async function getWebsiteSlots(
  slug: string,
  input: { serviceId: string; branchId?: string; from: string; to: string },
): Promise<WebsiteSlot[]> {
  return apiRequest(`/v1/tenant-websites/public/${encodeURIComponent(slug)}/slots`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function bookWebsiteAppointment(
  slug: string,
  input: {
    serviceId: string;
    branchId?: string;
    departmentId?: string;
    providerId: string;
    startAt: string;
    endAt: string;
    timeZone: string;
  },
) {
  return authenticatedApiRequest<{
    id: string;
    appointmentNumber: string;
    status: string;
    startAt: string;
    endAt: string;
    timeZone: string;
  }>(`/v1/tenant-websites/public/${encodeURIComponent(slug)}/appointments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function submitWebsiteEnquiry(
  slug: string,
  input: { name: string; email?: string; phone?: string; message: string; website: string },
) {
  return apiRequest<{ accepted: boolean; reference: string }>(
    `/v1/tenant-websites/public/${encodeURIComponent(slug)}/enquiries`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}