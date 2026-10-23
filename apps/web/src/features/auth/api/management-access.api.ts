import { authenticatedApiRequest } from '../../../lib/auth-api.js';

export interface ManagementAccessResponse {
  allowed: true;
}

export async function verifyManagementAccess(): Promise<ManagementAccessResponse> {
  return authenticatedApiRequest<ManagementAccessResponse>(
    '/v1/core/account/management-access',
  );
}
