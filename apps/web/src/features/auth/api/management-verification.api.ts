import { authenticatedApiRequest } from '../../../lib/auth-api.js';

export interface ManagementLoginVerificationResponse {
  challengeId: string;
  channel: string;
  target: string;
  expiresAt: string;
  deliveryStatus: string;
}

export async function requestManagementLoginVerification(): Promise<ManagementLoginVerificationResponse> {
  return authenticatedApiRequest<ManagementLoginVerificationResponse>(
    '/v1/verification/management-login/request',
    { method: 'POST' },
  );
}

export interface VerifyManagementLoginCodeInput {
  challengeId: string;
  code: string;
}

export async function verifyManagementLoginCode(
  input: VerifyManagementLoginCodeInput,
): Promise<{ verified: boolean; challengeId: string }> {
  return authenticatedApiRequest<{ verified: boolean; challengeId: string }>(
    '/v1/verification/management-login/verify',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}