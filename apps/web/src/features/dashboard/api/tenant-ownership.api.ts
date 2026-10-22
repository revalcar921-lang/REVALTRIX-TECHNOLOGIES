import { authenticatedApiRequest } from '../../../lib/auth-api.js';

export type OwnershipPartyType = 'INDIVIDUAL' | 'LEGAL_ENTITY' | 'GOVERNMENT_ENTITY';
export type OwnershipPartyRole = 'OWNER' | 'DIRECTOR' | 'BENEFICIAL_OWNER' | 'AUTHORIZED_OFFICIAL';
export type OwnershipEvidenceType = 'IDENTITY_DOCUMENT' | 'SELFIE' | 'BUSINESS_REGISTRATION' | 'GOVERNMENT_AUTHORITY' | 'AUTHORIZATION_LETTER';

export interface OwnershipEvidence {
  id: string;
  evidenceType: OwnershipEvidenceType;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface OwnershipParty {
  id: string;
  partyType: OwnershipPartyType;
  role: OwnershipPartyRole;
  fullName: string;
  registrationNumber: string | null;
  registrationCountry: string | null;
  identityDocumentType: string | null;
  status: 'NOT_STARTED' | 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  submittedAt: string | null;
  rejectionReason: string | null;
  evidence: OwnershipEvidence[];
}

export interface TenantOwnershipResponse {
  parties: OwnershipParty[];
  status: 'NOT_STARTED' | 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  declarationAcceptedAt: string | null;
  defaults: {
    individualName: string;
    entityName: string;
    registrationNumber: string;
    registrationCountry: string;
  };
}

export interface OwnershipPartyInput {
  partyType: OwnershipPartyType;
  role: OwnershipPartyRole;
  fullName: string;
  registrationNumber?: string;
  registrationCountry?: string;
  identityDocumentType?: string;
}

export function getMyOwnershipVerification(): Promise<TenantOwnershipResponse> {
  return authenticatedApiRequest('/v1/tenant-setup/ownership');
}

export function createOwnershipParty(input: OwnershipPartyInput): Promise<unknown> {
  return authenticatedApiRequest('/v1/tenant-setup/ownership/parties', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateOwnershipParty(partyId: string, input: OwnershipPartyInput): Promise<unknown> {
  return authenticatedApiRequest(`/v1/tenant-setup/ownership/parties/${partyId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function removeOwnershipParty(partyId: string): Promise<unknown> {
  return authenticatedApiRequest(`/v1/tenant-setup/ownership/parties/${partyId}`, { method: 'DELETE' });
}

export function uploadOwnershipEvidence(partyId: string, evidenceType: OwnershipEvidenceType, file: File): Promise<OwnershipEvidence> {
  const formData = new FormData();
  formData.set('evidenceType', evidenceType);
  formData.set('file', file);
  return authenticatedApiRequest(`/v1/tenant-setup/ownership/parties/${partyId}/evidence`, {
    method: 'POST',
    body: formData,
  });
}

export function removeOwnershipEvidence(partyId: string, evidenceId: string): Promise<unknown> {
  return authenticatedApiRequest(`/v1/tenant-setup/ownership/parties/${partyId}/evidence/${evidenceId}`, { method: 'DELETE' });
}

export function submitOwnershipDeclaration(accepted: boolean): Promise<TenantOwnershipResponse> {
  return authenticatedApiRequest('/v1/tenant-setup/ownership/submit', {
    method: 'POST',
    body: JSON.stringify({ accepted }),
  });
}