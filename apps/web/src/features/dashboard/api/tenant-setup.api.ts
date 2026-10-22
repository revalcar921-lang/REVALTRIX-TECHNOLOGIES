import { authenticatedApiRequest } from '../../../lib/auth-api.js';
import type { TenantSetupResponse } from '../types/tenant-setup.types.js';

export interface TenantSetupSettings {
  bookingPolicy: {
    minLeadTimeMinutes: number;
    cancellationWindowHours: number;
    rescheduleWindowHours: number;
    noShowFeeEnabled: boolean;
    maxBookingsPerDay: number;
    allowOnlineBooking: boolean;
  } | null;
  paymentConfig: {
    currency: string;
    acceptMpesa: boolean;
    acceptCard: boolean;
    acceptBankTransfer: boolean;
    acceptCash: boolean;
    depositRequired: boolean;
    depositPercent: number | null;
    mpesaPaybill: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
  } | null;
  resources: Array<{ id: string; branchId: string | null; name: string; type: string; capacity: number; isActive: boolean; updatedAt: string }>;
  documents: Array<{ id: string; type: string; title: string; documentNumber: string | null; issuingAuthority: string | null; issueDate: string | null; expiryDate: string | null; status: string; verificationStatus: string; rejectionReason: string | null; createdAt: string; updatedAt: string }>;
  compliance: { termsVersion: string | null; termsAcceptedAt: string | null; termsAcceptedByUserId: string | null; ownerIdentityStatus: string } | null;
  currentTermsVersion: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
}

export async function getTenantSetup(): Promise<TenantSetupResponse> {
  return authenticatedApiRequest<TenantSetupResponse>('/v1/tenant-setup');
}

export async function getTenantSetupSettings(): Promise<TenantSetupSettings> {
  return authenticatedApiRequest('/v1/tenant-setup/settings');
}

export async function saveBookingPolicy(input: NonNullable<TenantSetupSettings['bookingPolicy']>) {
  return authenticatedApiRequest('/v1/tenant-setup/booking-policy', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function savePaymentConfig(input: NonNullable<TenantSetupSettings['paymentConfig']>) {
  return authenticatedApiRequest('/v1/tenant-setup/payment-config', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function createOperationalResource(input: {
  branchId?: string;
  name: string;
  type: string;
  capacity: number;
}) {
  return authenticatedApiRequest('/v1/tenant-setup/resources', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function uploadTenantComplianceDocument(input: {
  type: string;
  title: string;
  documentNumber?: string;
  issuingAuthority?: string;
  issueDate?: string;
  expiryDate?: string;
  file: File;
}) {
  const body = new FormData();
  body.set('type', input.type);
  body.set('title', input.title);
  if (input.documentNumber) body.set('documentNumber', input.documentNumber);
  if (input.issuingAuthority) body.set('issuingAuthority', input.issuingAuthority);
  if (input.issueDate) body.set('issueDate', input.issueDate);
  if (input.expiryDate) body.set('expiryDate', input.expiryDate);
  body.set('file', input.file);
  return authenticatedApiRequest('/v1/tenant-setup/compliance/documents', {
    method: 'POST',
    body,
  });
}

export async function acceptTenantTerms(version: string) {
  return authenticatedApiRequest('/v1/tenant-setup/terms/accept', {
    method: 'POST',
    body: JSON.stringify({ version, accepted: true }),
  });
}

export async function requestTenantActivation(): Promise<{
  accepted: boolean;
  status: TenantSetupResponse['setup']['status'];
  message: string;
}> {
  return authenticatedApiRequest<{
    accepted: boolean;
    status: TenantSetupResponse['setup']['status'];
    message: string;
  }>('/v1/tenant-setup/activation/request', { method: 'POST' });
}
