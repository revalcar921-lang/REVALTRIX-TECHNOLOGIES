import { getAuthSession } from '../../auth/api/auth-session.js';
import { authenticatedApiRequest } from '../../../lib/auth-api.js';
import type { PendingOwnershipParty } from './tenant-ownership-review.api.js';
import type { PendingDependentVerification } from '../../patient-family/api/family-verification-admin.api.js';

const API_BASE_URL = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ?? '/api';

export interface PendingTenantDocument {
  id: string;
  tenantId: string;
  type: string;
  title: string;
  documentNumber: string | null;
  issuingAuthority: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: string;
  verificationStatus: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | string | null;
  uploadedByUserId: string | null;
  createdAt: string;
  tenant: { name: string; code: string; type: string; profile: { businessName: string | null; registrationNumber: string | null } | null };
}

export interface PendingTenantActivation {
  tenantId: string;
  readinessPercent: number;
  readyAt: string | null;
  activationRequestedAt: string | null;
  tenant: { name: string; legalName: string | null; type: string; code: string; profile: { businessName: string | null; registrationNumber: string | null; contactEmail: string | null; contactPhone: string | null } | null };
}

export interface SuperAdminQueues {
  documents: PendingTenantDocument[];
  ownership: PendingOwnershipParty[];
  activations: PendingTenantActivation[];
  dependents: PendingDependentVerification[];
}

export function getSuperAdminApprovalAccess(): Promise<boolean> {
  return authenticatedApiRequest('/v1/tenant-setup/admin/approvals/access');
}

export async function getSuperAdminQueues(): Promise<SuperAdminQueues> {
  const [documents, ownership, activations, dependents] = await Promise.all([
    authenticatedApiRequest<PendingTenantDocument[]>('/v1/tenant-setup/admin/documents'),
    authenticatedApiRequest<PendingOwnershipParty[]>('/v1/tenant-setup/admin/ownership'),
    authenticatedApiRequest<PendingTenantActivation[]>('/v1/tenant-setup/admin/activations'),
    authenticatedApiRequest<{ data: PendingDependentVerification[] }>('/v1/patient-family/admin/dependents'),
  ]);
  return { documents, ownership, activations, dependents: dependents.data };
}

export function reviewTenantDocument(documentId: string, decision: 'VERIFIED' | 'REJECTED', reason: string | undefined, stepUpId: string) {
  return authenticatedApiRequest(`/v1/tenant-setup/admin/documents/${documentId}/review`, {
    method: 'POST', body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }), headers: { 'x-step-up-challenge-id': stepUpId },
  });
}

export function reviewTenantActivation(tenantId: string, decision: 'APPROVE' | 'REJECT', reason: string | undefined, stepUpId: string) {
  return authenticatedApiRequest(`/v1/tenant-setup/admin/activations/${tenantId}/review`, {
    method: 'POST', body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }), headers: { 'x-step-up-challenge-id': stepUpId },
  });
}

export async function downloadTenantDocument(documentId: string, stepUpId: string): Promise<void> {
  const session = getAuthSession();
  if (!session) throw new Error('Authentication required.');
  const response = await fetch(`${API_BASE_URL}/v1/tenant-setup/admin/documents/${documentId}/download`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, 'x-step-up-challenge-id': stepUpId },
  });
  if (!response.ok) throw new Error(`Unable to open facility document (${response.status}).`);
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'facility-compliance-document';
  link.rel = 'noopener';
  link.click();
  URL.revokeObjectURL(objectUrl);
}