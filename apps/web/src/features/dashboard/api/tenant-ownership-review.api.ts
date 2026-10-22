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
  stepUpChallengeId: string,
): Promise<unknown> {
  return authenticatedApiRequest(`/v1/tenant-setup/admin/ownership/${partyId}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
    headers: { 'x-step-up-challenge-id': stepUpChallengeId },
  });
}

export async function downloadOwnershipEvidence(partyId: string, evidenceId: string, stepUpChallengeId: string): Promise<void> {
  const session = getAuthSession();
  if (!session) throw new Error('Authentication required.');
  const response = await fetch(`${API_BASE_URL}/v1/tenant-setup/admin/ownership/${partyId}/evidence/${evidenceId}`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, 'x-step-up-challenge-id': stepUpChallengeId },
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