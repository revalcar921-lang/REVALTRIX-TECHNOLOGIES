import { getAuthSession } from '../../auth/api/auth-session.js';
import { authenticatedApiRequest } from '../../../lib/auth-api.js';

const apiBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ?? '/api';

export interface PendingDependentVerification {
  id: string;
  status: string;
  createdAt: string;
  verificationNotes: string | null;
  dependentPatientProfile: {
    id: string;
    platformPatientId: string;
    firstName: string;
    secondName: string;
    dateOfBirth: string | null;
  };
  registeredByPatientProfile: {
    id: string;
    platformPatientId: string;
    firstName: string;
    secondName: string;
  };
  verificationDocuments: Array<{
    id: string;
    documentType: string;
    fileName: string;
    fileSize: string;
    createdAt: string;
  }>;
}

export function getPendingDependentVerifications(search = '') {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return authenticatedApiRequest<{ data: PendingDependentVerification[] }>(
    `/v1/patient-family/admin/dependents${query}`,
  );
}

export function reviewDependentVerification(
  registrationId: string,
  payload: { decision: 'APPROVE' | 'REJECT'; rejectionReason?: string },
) {
  return authenticatedApiRequest(
    `/v1/patient-family/admin/dependents/${encodeURIComponent(registrationId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export function flagDependentVerification(
  registrationId: string,
  reason: string,
) {
  return authenticatedApiRequest(
    `/v1/patient-family/admin/dependents/${encodeURIComponent(registrationId)}/flag`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export async function downloadDependentVerificationDocument(
  registrationId: string,
  documentId: string,
) {
  const session = getAuthSession();
  if (!session) throw new Error('Authentication required.');

  const response = await fetch(
    `${apiBaseUrl}/v1/patient-family/admin/dependents/${encodeURIComponent(registrationId)}/documents/${encodeURIComponent(documentId)}`,
    {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Unable to open verification document (${response.status}).`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'verification-document';
  link.rel = 'noopener';
  link.click();
  URL.revokeObjectURL(objectUrl);
}
