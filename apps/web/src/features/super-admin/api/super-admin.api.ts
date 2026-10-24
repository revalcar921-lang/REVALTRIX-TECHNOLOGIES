import { authenticatedApiRequest } from '../../../lib/auth-api.js';

export interface PlatformTenant {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  membershipCount: number;
  createdAt: string;
}

export interface PlatformStats {
  tenantCount: number;
  activeTenantCount: number;
  userCount: number;
}

export interface ManagementAccessResponse {
  allowed: true;
}

export interface PlatformUser {
  id: string;
  username: string | null;
  displayName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  platformRoles: Array<{
    id: string;
    name: string;
    code: string;
    scope: string;
  }>;
  membershipCount: number;
  sessionCount: number;
}

export interface PlatformUsersResponse {
  users: PlatformUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  reason: string | null;
  correlationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actorUser: { id: string; displayName: string; username: string | null } | null;
}

export interface AuditEventsResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SecurityEvent {
  id: string;
  eventType: string;
  severity: string;
  outcome: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actorUser: { id: string; displayName: string; username: string | null } | null;
}

export interface SecurityEventsResponse {
  events: SecurityEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listPlatformTenants(): Promise<PlatformTenant[]> {
  return authenticatedApiRequest<PlatformTenant[]>('/v1/platform-admin/tenants');
}

export async function getPlatformStats(): Promise<PlatformStats> {
  return authenticatedApiRequest<PlatformStats>('/v1/platform-admin/stats');
}

export async function listPlatformUsers(
  params?: { page?: number; limit?: number; status?: string },
): Promise<PlatformUsersResponse> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.status) qs.set('status', params.status);
  const path = `/v1/platform-admin/users${qs.toString() ? `?${qs.toString()}` : ''}`;
  return authenticatedApiRequest<PlatformUsersResponse>(path);
}

export async function listAuditEvents(
  params?: {
    page?: number; limit?: number; actorId?: string; action?: string;
    resourceType?: string; startDate?: string; endDate?: string;
  },
): Promise<AuditEventsResponse> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.actorId) qs.set('actorId', params.actorId);
  if (params?.action) qs.set('action', params.action);
  if (params?.resourceType) qs.set('resourceType', params.resourceType);
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  const path = `/v1/platform-admin/audit-events${qs.toString() ? `?${qs.toString()}` : ''}`;
  return authenticatedApiRequest<AuditEventsResponse>(path);
}

export async function listSecurityEvents(
  params?: {
    page?: number; limit?: number; actorId?: string; eventType?: string;
    severity?: string; startDate?: string; endDate?: string;
  },
): Promise<SecurityEventsResponse> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.actorId) qs.set('actorId', params.actorId);
  if (params?.eventType) qs.set('eventType', params.eventType);
  if (params?.severity) qs.set('severity', params.severity);
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  const path = `/v1/platform-admin/security-events${qs.toString() ? `?${qs.toString()}` : ''}`;
  return authenticatedApiRequest<SecurityEventsResponse>(path);
}

export async function verifyPlatformManagementAccess(): Promise<ManagementAccessResponse> {
  return authenticatedApiRequest<ManagementAccessResponse>(
    '/v1/platform-admin/management-access',
  );
}
