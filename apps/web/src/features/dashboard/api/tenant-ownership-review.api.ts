import { getAuthSession } from '../../auth/api/auth-session.js';
import { authenticatedApiRequest } from '../../../lib/auth-api.js';
import type { OwnershipEvidence, OwnershipPartyRole, OwnershipPartyType } from './tenant-ownership.api.js';

const API_BASE_URL = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ?? '/api';

export interface PendingOwnershipParty {
  id: string;
  tenantId: string;
  partyType: OwnershipPartyType;
  role: OwnershipPartyRole;
  fullName: string;
  registrationNumber: string | null;
  registrationCountry: string | null;
  identityDocumentType: string | null;
  submittedAt: string | null;
  tenant: { name: string; code: string; type: string; profile: { businessName: string | null; registrationNumber: string | null; ownershipType: string | null } | null };
  evidence: OwnershipEvidence[];
}

export function getPendingOwnershipParties(): Promise<PendingOwnershipParty[]> {
  return authenticatedApiRequest('/v1/tenant-setup/admin/ownership');
}

export function getOwnershipReviewAccess(): Promise<boolean> {
  return authenticatedApiRequest('/v1/tenant-setup/admin/ownership/access');
}

export function reviewOwnershipParty(
  partyId: string,
  decision: 'VERIFIED' | 'REJECTED',
  reason: string | undefined,
): Promise<unknown> {
  return authenticatedApiRequest(`/v1/tenant-setup/admin/ownership/${partyId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
}

export interface PendingActivation {
  id: string;
  tenantId: string;
  readinessPercent: number | null;
  readyAt: string | null;
  activationRequestedAt: string | null;
  tenant: {
    name: string;
    legalName: string | null;
    type: string;
    code: string;
    profile: {
      businessName: string | null;
      registrationNumber: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
    } | null;
  };
}

export function getPendingActivations(): Promise<PendingActivation[]> {
  return authenticatedApiRequest('/v1/tenant-setup/admin/activations');
}

export function reviewActivation(
  tenantId: string,
  decision: 'APPROVE' | 'REJECT',
  reason: string | undefined,
): Promise<unknown> {
  return authenticatedApiRequest(`/v1/tenant-setup/admin/activation/${tenantId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
}

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
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
  tenant: {
    name: string;
    code: string;
    type: string;
    profile: {
      businessName: string | null;
      registrationNumber: string | null;
    } | null;
  };
}

export function getPendingTenantDocuments(): Promise<PendingTenantDocument[]> {
  return authenticatedApiRequest('/v1/tenant-setup/admin/documents');
}

export function reviewTenantDocument(
  documentId: string,
  decision: 'VERIFIED' | 'REJECTED',
  reason: string | undefined,
): Promise<unknown> {
  return authenticatedApiRequest(`/v1/tenant-setup/admin/documents/${documentId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
}

export async function downloadTenantDocument(
  documentId: string,
): Promise<void> {
  const session = getAuthSession();
  if (!session) throw new Error('Authentication required.');
  const response = await fetch(`${API_BASE_URL}/v1/tenant-setup/admin/documents/${documentId}/download`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) throw new Error(`Unable to download document (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'document';
  link.rel = 'noopener';
  link.click();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadOwnershipEvidence(partyId: string, evidenceId: string): Promise<void> {
  const session = getAuthSession();
  if (!session) throw new Error('Authentication required.');
  const response = await fetch(`${API_BASE_URL}/v1/tenant-setup/admin/ownership/${partyId}/evidence/${evidenceId}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) throw new Error(`Unable to download ownership evidence (${response.status}).`);
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'ownership-evidence';
  link.rel = 'noopener';
  link.click();
  URL.revokeObjectURL(objectUrl);
}