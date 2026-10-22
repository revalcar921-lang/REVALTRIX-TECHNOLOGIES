import { authenticatedApiRequest } from '../../../lib/auth-api.js';
import type { ProviderType } from '../../staff/types/professional-title-options.js';

export type { ProviderType };

export interface ProviderProfile {
  id: string;
  providerNumber: string;
  providerType: ProviderType;
  professionalTitle: string | null;
  specialty: string | null;
  status: string;
  user: { id: string; displayName: string; username: string };
}

export interface ProviderAvailability {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  timeZone: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  branch: { id: string; name: string };
  department: { id: string; name: string };
  service: { id: string; name: string };
}

export interface CreateProviderInput {
  userId: string;
  providerNumber: string;
  providerType: ProviderType;
  professionalTitle?: string;
  specialty?: string;
  licenseNumber?: string;
}

export interface EligibleProviderStaff {
  id: string;
  user: { id: string; displayName: string; username: string };
  staffNumber: string | null;
  professionalCategory: string | null;
  jobTitle: string | null;
  specialty: string | null;
  licenseNumber: string | null;
  branchId: string | null;
  departmentId: string | null;
  serviceIds: string[];
  shifts: Array<{
    startTime: string;
    endTime: string;
    daysOfWeek: string[] | null;
    branchId: string | null;
    departmentId: string;
  }>;
}

export interface CreateAvailabilityInput {
  branchId: string;
  departmentId: string;
  serviceId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  timeZone: string;
  effectiveFrom: string;
}

export function getProviders(): Promise<{ items: ProviderProfile[] }> {
  return authenticatedApiRequest('/v1/providers?pageSize=100');
}

export function getEligibleProviderStaff(): Promise<EligibleProviderStaff[]> {
  return authenticatedApiRequest('/v1/providers/eligible-users');
}

export function createProvider(input: CreateProviderInput): Promise<ProviderProfile> {
  return authenticatedApiRequest('/v1/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getProviderAvailability(providerId: string): Promise<ProviderAvailability[]> {
  return authenticatedApiRequest(`/v1/providers/${providerId}/availability`);
}

export function createProviderAvailability(providerId: string, input: CreateAvailabilityInput): Promise<ProviderAvailability> {
  return authenticatedApiRequest(`/v1/providers/${providerId}/availability`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deactivateProviderAvailability(providerId: string, availabilityId: string): Promise<unknown> {
  return authenticatedApiRequest(`/v1/providers/${providerId}/availability/${availabilityId}`, {
    method: 'DELETE',
  });
}