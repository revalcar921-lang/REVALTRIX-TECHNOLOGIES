import { authenticatedApiRequest } from '../../../lib/auth-api.js';
import { getAuthSession } from '../../auth/api/auth-session.js';
import type {
  CreateStaffInput,
  CreateStaffResponse,
  AssignStaffDepartmentInput,
  CreateStaffShiftInput,
  StaffAccessAttempt,
  StaffMeResponse,
  StaffMember,
  StaffDocument,
  StaffTimeOff,
  UpdateStaffInput,
} from '../types/staff.types.js';

async function downloadPrivateStaffFile(path: string): Promise<Blob | null> {
  const session = getAuthSession();
  if (!session) throw new Error('Authentication required.');
  const apiBase = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ?? '/api';
  const response = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Private staff file request failed (${response.status})`);
  return response.blob();
}

export function getStaff(): Promise<StaffMember[]> {
  return authenticatedApiRequest<StaffMember[]>('/v1/staff');
}

export function getMyStaffProfile(): Promise<StaffMeResponse> {
  return authenticatedApiRequest<StaffMeResponse>('/v1/staff/me');
}

export function createStaff(input: CreateStaffInput): Promise<CreateStaffResponse> {
  return authenticatedApiRequest<CreateStaffResponse>('/v1/staff/invite', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateStaffProfile(staffProfileId: string, input: UpdateStaffInput): Promise<{ id: string; updatedAt: string }> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function resendStaffInvitation(
  staffProfileId: string,
): Promise<{ invitationStatus: string }> {
  return authenticatedApiRequest<{ invitationStatus: string }>(
    `/v1/staff/${staffProfileId}/resend-invitation`,
    { method: 'POST' },
  );
}

export function revokeStaffInvitation(staffProfileId: string): Promise<unknown> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/revoke-invitation`, {
    method: 'POST',
  });
}

export function approveStaffInvitation(
  staffProfileId: string,
): Promise<{ approvalStatus: 'APPROVED'; passwordSetupEmailStatus: 'SENT' }> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/approve`, { method: 'POST' });
}

export function assignStaffDepartment(
  staffProfileId: string,
  input: AssignStaffDepartmentInput,
): Promise<unknown> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/assignments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revokeStaffDepartment(
  staffProfileId: string,
  assignmentId: string,
): Promise<unknown> {
  return authenticatedApiRequest(
    `/v1/staff/${staffProfileId}/assignments/${assignmentId}`,
    { method: 'DELETE' },
  );
}

export function createStaffShift(
  staffProfileId: string,
  input: CreateStaffShiftInput,
): Promise<unknown> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/shifts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listStaffDocuments(staffProfileId: string): Promise<StaffDocument[]> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/documents`);
}

export function removeStaffProfilePhoto(staffProfileId: string): Promise<{ profilePhotoRemoved: true }> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/photo`, { method: 'DELETE' });
}

export function uploadStaffDocument(
  staffProfileId: string,
  type: string,
  file: File,
  expiresAt?: string,
): Promise<StaffDocument> {
  const formData = new FormData();
  formData.set('type', type);
  if (expiresAt) formData.set('expiresAt', expiresAt);
  formData.set('file', file);
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/documents`, {
    method: 'POST',
    body: formData,
  });
}

export function reviewStaffDocument(
  staffProfileId: string,
  documentId: string,
  status: 'VERIFIED' | 'REJECTED',
  reviewNotes?: string,
): Promise<unknown> {
  return authenticatedApiRequest(
    `/v1/staff/${staffProfileId}/documents/${documentId}/review`,
    { method: 'PATCH', body: JSON.stringify({ status, reviewNotes }) },
  );
}

export function removeStaffDocument(staffProfileId: string, documentId: string): Promise<unknown> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/documents/${documentId}`, {
    method: 'DELETE',
  });
}

export async function downloadStaffDocument(
  staffProfileId: string,
  documentId: string,
): Promise<Blob> {
  return downloadPrivateStaffFile(`/v1/staff/${staffProfileId}/documents/${documentId}/download`);
}

export function downloadStaffPhoto(staffProfileId: string): Promise<Blob> {
  return downloadPrivateStaffFile(`/v1/staff/${staffProfileId}/photo`);
}

export function listStaffTimeOff(staffProfileId: string): Promise<StaffTimeOff[]> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/time-off`);
}

export function createStaffTimeOff(
  staffProfileId: string,
  input: { startsAt: string; endsAt: string; reason?: string },
): Promise<StaffTimeOff> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/time-off`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function reviewStaffTimeOff(
  staffProfileId: string,
  timeOffId: string,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
): Promise<unknown> {
  return authenticatedApiRequest(`/v1/staff/${staffProfileId}/time-off/${timeOffId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function updateStaffStatus(
  staffProfileId: string,
  status: StaffMember['status'],
): Promise<StaffMember> {
  const actions: Partial<Record<StaffMember['status'], string>> = {
    ACTIVE: 'reactivate',
    SUSPENDED: 'suspend',
    OFFBOARDED: 'offboard',
  };
  const action = actions[status];
  if (!action) throw new Error(`Unsupported staff status change: ${status}`);
  return authenticatedApiRequest<StaffMember>(`/v1/staff/${staffProfileId}/${action}`, {
    method: 'POST',
  });
}

export function requestStaffPasswordReset(
  staffProfileId: string,
): Promise<{ resetEmailStatus: 'SENT' }> {
  return authenticatedApiRequest<{ resetEmailStatus: 'SENT' }>(
    `/v1/staff/${staffProfileId}/reset-password`,
    { method: 'POST' },
  );
}

export function getStaffAccessHistory(staffProfileId: string): Promise<StaffAccessAttempt[]> {
  return authenticatedApiRequest<StaffAccessAttempt[]>(
    `/v1/staff/${staffProfileId}/access-history`,
  );
}

// Aliases for StaffPage compatibility
export const getStaffDirectory = getStaff;
export const getStaffDocuments = listStaffDocuments;
export const deleteStaffDocument = removeStaffDocument;
export const getStaffTimeOff = listStaffTimeOff;
export const removeStaffDepartmentAssignment = revokeStaffDepartment;
export const updateStaffMemberStatus = (staffProfileId: string, input: { status: StaffMember['status']; reason?: string }) => updateStaffStatus(staffProfileId, input.status);
export const offboardStaffMember = (staffProfileId: string, input: { reason?: string }) => updateStaffStatus(staffProfileId, 'OFFBOARDED');
export const progressStaffInvitation = approveStaffInvitation;
