import { authenticatedApiRequest } from '../../../lib/auth-api.js';
import { apiRequest } from '../../../lib/api.js';
import type {
  Appointment,
  CreateRecurringAppointmentInput,
  CreateRecurringAppointmentResult,
  AppointmentStatus,
  CreateAppointmentInput,
  CreatePatientAppointmentInput,
  AppointmentFacility,
  AppointmentSlot,
  PatientBookingEligibility,
} from '../types/appointment.types.js';



export async function discoverAppointmentFacilities(search?: string): Promise<AppointmentFacility[]> {
  const params = new URLSearchParams();
  if (search?.trim()) params.set('search', search.trim());
  const query = params.size ? `?${params.toString()}` : '';
  return apiRequest<AppointmentFacility[]>(`/v1/appointments/public/discovery/facilities${query}`);
}

export interface DiscoverAppointmentSlotsInput {
  tenantId: string;
  serviceId: string;
  from: string;
  to: string;
  providerId?: string;
  branchId?: string;
  departmentId?: string;
}

export async function discoverAppointmentSlots(
  input: DiscoverAppointmentSlotsInput,
): Promise<AppointmentSlot[]> {
  const params = new URLSearchParams({
    tenantId: input.tenantId,
    serviceId: input.serviceId,
    from: input.from,
    to: input.to,
  });

  if (input.providerId) params.set('providerId', input.providerId);
  if (input.branchId) params.set('branchId', input.branchId);
  if (input.departmentId) params.set('departmentId', input.departmentId);

  return apiRequest<AppointmentSlot[]>(
    `/v1/appointments/public/discovery/slots?${params.toString()}`,
  );
}

export async function bookPatientAppointment(
  input: CreatePatientAppointmentInput,
): Promise<Appointment> {
  return authenticatedApiRequest<Appointment>('/v1/appointments/my/book', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getPatientBookingEligibility(tenantId: string): Promise<PatientBookingEligibility> {
  const params = new URLSearchParams({ tenantId });
  return authenticatedApiRequest(`/v1/appointments/my/booking-eligibility?${params.toString()}`);
}

export interface AppointmentSlotHoldInput {
  tenantId: string;
  serviceId: string;
  providerId: string;
  branchId: string;
  departmentId?: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  reason?: string;
  idempotencyKey: string;
}

export async function createAppointmentSlotHold(input: AppointmentSlotHoldInput) {
  return authenticatedApiRequest<{ id: string; expiresAt: string; status: string }>('/v1/appointments/my/slot-holds', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function initiateAppointmentDeposit(holdId: string, input: { phoneNumber: string; idempotencyKey: string }) {
  return authenticatedApiRequest<{ paymentIntentId: string; reference: string; status: string; expiresAt: string }>(
    `/v1/appointments/my/slot-holds/${encodeURIComponent(holdId)}/payment`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function getAppointmentPaymentStatus(paymentIntentId: string) {
  return authenticatedApiRequest<{
    id: string;
    internalReference: string;
    amount: string;
    currency: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'RECONCILIATION_REQUIRED';
    providerReceipt: string | null;
    paidAt: string | null;
    expiresAt: string;
    appointment: { id: string; appointmentNumber: string; status: string } | null;
  }>(`/v1/appointments/my/payments/${encodeURIComponent(paymentIntentId)}`);
}

export async function getAppointments(): Promise<Appointment[]> {
  return authenticatedApiRequest<Appointment[]>('/v1/appointments');
}

export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<Appointment> {
  return authenticatedApiRequest<Appointment>('/v1/appointments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

const transitionRoutes: Partial<Record<AppointmentStatus, string>> = {
  CONFIRMED: 'confirm',
  CHECKED_IN: 'check-in',
  IN_PROGRESS: 'start',
  COMPLETED: 'complete',
  CANCELLED: 'cancel',
  NO_SHOW: 'no-show',
  REJECTED: 'reject',
};

export async function transitionAppointment(
  appointmentId: string,
  status: AppointmentStatus,
  reason?: string,
): Promise<Appointment> {
  const action = transitionRoutes[status];
  if (!action) {
    throw new Error(`Unsupported appointment action: ${status}`);
  }

  return authenticatedApiRequest<Appointment>(
    `/v1/appointments/${encodeURIComponent(appointmentId)}/${action}`,
    {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
}

export async function requestAppointmentRefund(appointmentId: string, reason: string) {
  return authenticatedApiRequest<{ id: string; status: string }>(
    `/v1/appointments/my/${encodeURIComponent(appointmentId)}/refund-request`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

export async function reviewAppointmentRefund(
  appointmentId: string,
  refundId: string,
  input: { status: 'PENDING' | 'REFUNDED' | 'FAILED' | 'DISPUTED' | 'NOT_ELIGIBLE'; reason: string; evidenceRef?: string; providerReference?: string; refundMethod?: 'CASH' | 'MPESA' | 'BANK_TRANSFER' | 'OTHER' },
) {
  return authenticatedApiRequest(
    `/v1/appointments/${encodeURIComponent(appointmentId)}/refunds/${encodeURIComponent(refundId)}/review`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function createRecurringAppointment(
  input: CreateRecurringAppointmentInput,
): Promise<CreateRecurringAppointmentResult> {
  return authenticatedApiRequest<CreateRecurringAppointmentResult>(
    '/v1/appointments/recurring',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}