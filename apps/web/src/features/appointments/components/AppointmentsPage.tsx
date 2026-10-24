import { FormEvent, useEffect, useState } from 'react';
import './AppointmentsPage.css';
import {
  createAppointment,
  createRecurringAppointment,
  getAppointments,
  reviewAppointmentRefund,
  transitionAppointment,
} from '../api/appointments.api.js';
import type {
  Appointment,
  AppointmentStatus,
} from '../types/appointment.types.js';
import { getPatients } from '../../patients/api/patients.api.js';
import type { PatientListItem } from '../../patients/types/patient.types.js';
import { getDepartments } from '../../departments/api/departments.api.js';
import type { Department } from '../../departments/types/department.types.js';
import { getServices } from '../../services/api/services.api.js';
import type { Service } from '../../services/types/service.types.js';

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localDateValue(date: Date): string {
  return localDateTimeValue(date).slice(0, 10);
}

function displayDate(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

const weekdays = [
  { label: 'Sunday', short: 'Sun', value: 0 },
  { label: 'Monday', short: 'Mon', value: 1 },
  { label: 'Tuesday', short: 'Tue', value: 2 },
  { label: 'Wednesday', short: 'Wed', value: 3 },
  { label: 'Thursday', short: 'Thu', value: 4 },
  { label: 'Friday', short: 'Fri', value: 5 },
  { label: 'Saturday', short: 'Sat', value: 6 },
];

const actions: Partial<
  Record<AppointmentStatus, { label: string; status: AppointmentStatus }[]>
> = {
  REQUESTED: [
    { label: 'Confirm', status: 'CONFIRMED' },
    { label: 'Reject', status: 'REJECTED' },
    { label: 'Cancel', status: 'CANCELLED' },
  ],
  PENDING_APPROVAL: [
    { label: 'Confirm', status: 'CONFIRMED' },
    { label: 'Reject', status: 'REJECTED' },
    { label: 'Cancel', status: 'CANCELLED' },
  ],
  CONFIRMED: [
    { label: 'Check in', status: 'CHECKED_IN' },
    { label: 'Mark no-show', status: 'NO_SHOW' },
    { label: 'Cancel', status: 'CANCELLED' },
  ],
  CHECKED_IN: [
    { label: 'Start', status: 'IN_PROGRESS' },
    { label: 'Cancel', status: 'CANCELLED' },
  ],
  IN_PROGRESS: [{ label: 'Complete', status: 'COMPLETED' }],
};

export function AppointmentsPage({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const [patientId, setPatientId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [serviceId, setServiceId] = useState('');

  const [startAt, setStartAt] = useState(() =>
    localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [endAt, setEndAt] = useState(() =>
    localDateTimeValue(new Date(Date.now() + 90 * 60 * 1000)),
  );
  const [reason, setReason] = useState('');

  const [recurringWeekdays, setRecurringWeekdays] = useState<number[]>([1, 5]);
  const [recurringStartDate, setRecurringStartDate] = useState(() =>
    localDateValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  );
  const [recurringStartTime, setRecurringStartTime] = useState('09:00');
  const [recurringDuration, setRecurringDuration] = useState(30);
  const [recurringEndMode, setRecurringEndMode] = useState<'date' | 'count'>(
    'count',
  );
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [recurringMaxOccurrences, setRecurringMaxOccurrences] = useState(8);
  const [recurringIntervalWeeks, setRecurringIntervalWeeks] = useState(1);
  const [recurringReason, setRecurringReason] = useState('');
  const [recurringPatientNotes, setRecurringPatientNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recurringSaving, setRecurringSaving] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const [appointmentResult, patientResult, departmentResult, serviceResult] =
        await Promise.all([
          getAppointments(),
          getPatients({ status: 'ACTIVE', page: 1, pageSize: 100 }),
          getDepartments(),
          getServices(),
        ]);

      setAppointments(appointmentResult);
      setPatients(patientResult.data);
      setDepartments(departmentResult);
      setServices(serviceResult);

      if (!patientId && patientResult.data.length) {
        setPatientId(patientResult.data[0].id);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load appointments.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!patientId) {
      setError('Select a registered patient first.');
      return;
    }

    if (!departmentId && !serviceId) {
      setError('Select a department or a service.');
      return;
    }

    const start = new Date(startAt);
    const end = new Date(endAt);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start <= new Date() ||
      end <= start
    ) {
      setError('Choose a future start time and an end time after the start.');
      return;
    }

    setSaving(true);

    try {
      const created = await createAppointment({
        patientTenantRecordId: patientId,
        ...(departmentId ? { departmentId } : {}),
        ...(serviceId ? { serviceId } : {}),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });

      setAppointments((current) =>
        [...current, created].sort(
          (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
        ),
      );
      setReason('');
      setSuccess(`Appointment ${created.appointmentNumber} created.`);
      await loadData();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Unable to create appointment.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitRecurringAppointment(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!patientId) {
      setError('Select a registered patient first.');
      return;
    }

    if (!departmentId && !serviceId) {
      setError('Select a department or a service.');
      return;
    }

    if (!recurringWeekdays.length) {
      setError('Select at least one weekday.');
      return;
    }

    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(recurringStartTime)) {
      setError('Enter a valid local start time.');
      return;
    }

    if (
      !Number.isInteger(recurringDuration) ||
      recurringDuration < 5 ||
      recurringDuration > 720
    ) {
      setError('Duration must be between 5 minutes and 12 hours.');
      return;
    }

    if (
      !Number.isInteger(recurringIntervalWeeks) ||
      recurringIntervalWeeks < 1 ||
      recurringIntervalWeeks > 52
    ) {
      setError('Repeat interval must be between 1 and 52 weeks.');
      return;
    }

    if (!recurringStartDate || recurringStartDate < localDateValue(new Date())) {
      setError('Choose a start date that is today or in the future.');
      return;
    }

    if (
      recurringEndMode === 'date' &&
      (!recurringEndDate || recurringEndDate < recurringStartDate)
    ) {
      setError('Choose an end date on or after the start date.');
      return;
    }

    if (
      recurringEndMode === 'count' &&
      (!Number.isInteger(recurringMaxOccurrences) ||
        recurringMaxOccurrences < 1 ||
        recurringMaxOccurrences > 52)
    ) {
      setError('Choose between 1 and 52 appointments.');
      return;
    }

    const [hours, minutes] = recurringStartTime.split(':').map(Number);
    const startMinute = hours * 60 + minutes;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    setRecurringSaving(true);

    try {
      const result = await createRecurringAppointment({
        patientTenantRecordId: patientId,
        ...(departmentId ? { departmentId } : {}),
        ...(serviceId ? { serviceId } : {}),
        startDate: recurringStartDate,
        ...(recurringEndMode === 'date'
          ? { endDate: recurringEndDate }
          : { maxOccurrences: recurringMaxOccurrences }),
        weekdays: [...recurringWeekdays].sort((a, b) => a - b),
        intervalWeeks: recurringIntervalWeeks,
        startMinute,
        durationMinutes: recurringDuration,
        timeZone,
        ...(recurringReason.trim()
          ? { reason: recurringReason.trim() }
          : {}),
        ...(recurringPatientNotes.trim()
          ? { patientNotes: recurringPatientNotes.trim() }
          : {}),
      });

      setSuccess(
        `Recurring series created successfully: ${result.appointments.length} appointment(s) scheduled.`,
      );
      setRecurringReason('');
      setRecurringPatientNotes('');
      await loadData();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Unable to create recurring appointments.',
      );
    } finally {
      setRecurringSaving(false);
    }
  }

  async function runAction(
    appointment: Appointment,
    status: AppointmentStatus,
  ) {
    let reasonText: string | undefined;

    if (
      status === 'CANCELLED' ||
      status === 'REJECTED' ||
      status === 'NO_SHOW'
    ) {
      const entered = window.prompt(
        status === 'CANCELLED'
          ? 'Reason for cancellation:'
          : status === 'NO_SHOW'
            ? 'Reason for suspected no-show (the patient can dispute this):'
            : 'Reason for rejection:',
      );

      if (entered === null) return;

      if (entered.trim().length < 3) {
        setError('Please enter a reason of at least 3 characters.');
        return;
      }

      reasonText = entered.trim();
    }

    setActingId(appointment.id);
    setError(null);
    setSuccess(null);

    try {
      await transitionAppointment(appointment.id, status, reasonText);
      setSuccess(
        `Appointment ${appointment.appointmentNumber} updated to ${status.replaceAll('_', ' ').toLowerCase()}.`,
      );
      await loadData();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Unable to update appointment.',
      );
    } finally {
      setActingId(null);
    }
  }

  async function reviewRefund(
    appointment: Appointment,
    refundId: string,
    status:
      | 'PENDING'
      | 'REFUNDED'
      | 'FAILED'
      | 'DISPUTED'
      | 'NOT_ELIGIBLE',
  ) {
    const refundReason = window.prompt(
      `Reason for marking refund ${status.toLowerCase().replaceAll('_', ' ')}:`,
    );

    if (!refundReason?.trim() || refundReason.trim().length < 3) {
      setError('A refund review reason of at least 3 characters is required.');
      return;
    }

    const evidenceRef =
      status === 'REFUNDED'
        ? window
            .prompt('Evidence reference for the completed refund (required):')
            ?.trim()
        : undefined;

    const methodInput =
      status === 'REFUNDED'
        ? window
            .prompt('Refund method: CASH, MPESA, BANK_TRANSFER, or OTHER')
            ?.trim()
            .toUpperCase()
        : undefined;

    const refundMethod = [
      'CASH',
      'MPESA',
      'BANK_TRANSFER',
      'OTHER',
    ].includes(methodInput ?? '')
      ? (methodInput as 'CASH' | 'MPESA' | 'BANK_TRANSFER' | 'OTHER')
      : undefined;

    const providerReference =
      status === 'REFUNDED' && refundMethod && refundMethod !== 'CASH'
        ? window
            .prompt('Electronic refund transaction reference (required):')
            ?.trim()
        : undefined;

    if (
      status === 'REFUNDED' &&
      (!evidenceRef ||
        !refundMethod ||
        (refundMethod !== 'CASH' && !providerReference))
    ) {
      setError(
        'Refund evidence and method are required; electronic refunds need a transaction reference.',
      );
      return;
    }

    setActingId(appointment.id);
    setError(null);
    setSuccess(null);

    try {
      await reviewAppointmentRefund(appointment.id, refundId, {
        status,
        reason: refundReason.trim(),
        ...(evidenceRef ? { evidenceRef } : {}),
        ...(providerReference ? { providerReference } : {}),
        ...(refundMethod ? { refundMethod } : {}),
      });

      setSuccess(
        `Refund for appointment ${appointment.appointmentNumber} updated.`,
      );
      await loadData();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : 'Unable to update refund.',
      );
    } finally {
      setActingId(null);
    }
  }

  return (
    <section className="dashboard-content appointments-page">
      <header className="dashboard-page-header">
        <div>
          <h1>Appointments</h1>
          <p>Schedule visits and manage patient appointment flow.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
        >
          Refresh
        </button>
      </header>

      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}

      <section className="appointments-panel appointments-create-panel">
        <div className="appointments-panel-heading">
          <div>
            <h2>Schedule appointment</h2>
            <p>
              Choose the patient and visit details to create a single booking.
            </p>
          </div>
        </div>

        <form className="appointment-form" onSubmit={submitAppointment}>
          <label>
            Registered patient
            <select
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              required
            >
              <option value="">Select patient</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.patient.displayName} — {patient.patientNumber}
                </option>
              ))}
            </select>
          </label>

          <label>
            Department
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">No department selected</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Service
            <select
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
            >
              <option value="">No service selected</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Start
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
            />
          </label>

          <label>
            End
            <input
              type="datetime-local"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              required
            />
          </label>

          <label>
            Reason for visit
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder="Optional"
            />
          </label>

          <button
            type="submit"
            disabled={saving || loading || !patients.length}
          >
            {saving ? 'Saving…' : 'Create appointment'}
          </button>

          {!loading && patients.length === 0 && (
            <p>
              No active registered patients are available. Register or activate
              a patient first.
            </p>
          )}
        </form>
      </section>

      <section className="appointments-panel appointments-create-panel">
        <div className="appointments-panel-heading">
          <div>
            <h2>Recurring appointments</h2>
            <p>
              Schedule a series of individual visits on selected weekdays,
              such as every Monday and Friday.
            </p>
          </div>
        </div>

        <form
          className="appointment-form"
          onSubmit={submitRecurringAppointment}
        >
          <label>
            Registered patient
            <select
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              required
            >
              <option value="">Select patient</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.patient.displayName} — {patient.patientNumber}
                </option>
              ))}
            </select>
          </label>

          <label>
            Department
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">No department selected</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Service
            <select
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
            >
              <option value="">No service selected</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="appointment-weekday-fieldset">
            <legend>Repeat on</legend>
            <div className="appointment-weekday-options">
              {weekdays.map((day) => (
                <label key={day.value}>
                  <input
                    type="checkbox"
                    checked={recurringWeekdays.includes(day.value)}
                    onChange={(event) =>
                      setRecurringWeekdays((current) =>
                        event.target.checked
                          ? [...current, day.value].sort((a, b) => a - b)
                          : current.filter((value) => value !== day.value),
                      )
                    }
                  />
                  {day.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            First date
            <input
              type="date"
              value={recurringStartDate}
              min={localDateValue(new Date())}
              onChange={(event) => setRecurringStartDate(event.target.value)}
              required
            />
          </label>

          <label>
            Local start time
            <input
              type="time"
              value={recurringStartTime}
              onChange={(event) => setRecurringStartTime(event.target.value)}
              required
            />
          </label>

          <label>
            Duration (minutes)
            <input
              type="number"
              min={5}
              max={720}
              step={5}
              value={recurringDuration}
              onChange={(event) =>
                setRecurringDuration(Number(event.target.value))
              }
              required
            />
          </label>

          <label>
            Repeat every (weeks)
            <input
              type="number"
              min={1}
              max={52}
              value={recurringIntervalWeeks}
              onChange={(event) =>
                setRecurringIntervalWeeks(Number(event.target.value))
              }
              required
            />
          </label>

          <label>
            End condition
            <select
              value={recurringEndMode}
              onChange={(event) =>
                setRecurringEndMode(event.target.value as 'date' | 'count')
              }
            >
              <option value="count">Number of appointments</option>
              <option value="date">End date</option>
            </select>
          </label>

          {recurringEndMode === 'date' ? (
            <label>
              Last date
              <input
                type="date"
                min={recurringStartDate}
                value={recurringEndDate}
                onChange={(event) => setRecurringEndDate(event.target.value)}
                required
              />
            </label>
          ) : (
            <label>
              Number of appointments
              <input
                type="number"
                min={1}
                max={52}
                value={recurringMaxOccurrences}
                onChange={(event) =>
                  setRecurringMaxOccurrences(Number(event.target.value))
                }
                required
              />
            </label>
          )}

          <label>
            Reason for visit
            <input
              value={recurringReason}
              onChange={(event) => setRecurringReason(event.target.value)}
              maxLength={1000}
              placeholder="Optional"
            />
          </label>

          <label>
            Patient notes
            <textarea
              value={recurringPatientNotes}
              onChange={(event) =>
                setRecurringPatientNotes(event.target.value)
              }
              maxLength={2000}
              rows={3}
              placeholder="Optional notes for these appointments"
            />
          </label>

          <p>
            Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
          </p>

          <button
            type="submit"
            disabled={
              recurringSaving ||
              saving ||
              loading ||
              !patients.length
            }
          >
            {recurringSaving
              ? 'Creating series…'
              : 'Create recurring appointments'}
          </button>
        </form>
      </section>

      <section className="appointments-panel appointments-schedule-panel">
        <div className="appointments-panel-heading">
          <div>
            <h2>Appointment schedule</h2>
            <p>
              Review bookings, payment details, and update appointment status.
            </p>
          </div>
          <span className="appointments-count">
            {appointments.length}{' '}
            {appointments.length === 1 ? 'appointment' : 'appointments'}
          </span>
        </div>

        {loading ? (
          <p>Loading appointments…</p>
        ) : appointments.length === 0 ? (
          <p>No appointments found for this facility.</p>
        ) : (
          <div className="appointments-list">
            {appointments.map((appointment) => (
              <article className="appointment-record" key={appointment.id}>
                <h3>
                  {appointment.appointmentNumber} ·{' '}
                  {appointment.status.replaceAll('_', ' ')}
                </h3>

                {appointment.bookingSource === 'PATIENT_PORTAL' ? (
                  <p className="appointment-online-badge">Online booking</p>
                ) : null}

                <p>
                  Patient number: {appointment.patientTenantRecord.patientNumber}
                </p>

                <p>
                  {displayDate(appointment.startAt, appointment.timeZone)} –{' '}
                  {displayDate(appointment.endAt, appointment.timeZone)}
                </p>

                <p>
                  Department: {appointment.department?.name ?? '—'} · Service:{' '}
                  {appointment.service?.name ?? '—'}
                </p>

                {appointment.paymentIntents?.[0] ? (
                  <p className="appointment-payment-summary">
                    Deposit: {appointment.paymentIntents[0].currency}{' '}
                    {appointment.paymentIntents[0].amount} ·{' '}
                    {appointment.paymentIntents[0].status.replaceAll('_', ' ')}
                    {appointment.paymentIntents[0].providerReceipt
                      ? ` · M-Pesa receipt ${appointment.paymentIntents[0].providerReceipt}`
                      : ''}
                  </p>
                ) : null}

                {appointment.refunds?.map((refund) => (
                  <div className="appointment-refund-summary" key={refund.id}>
                    <p>
                      Refund: {refund.status.replaceAll('_', ' ')} ·{' '}
                      {refund.currency} {refund.amount}
                      {refund.refundMethod
                        ? ` · ${refund.refundMethod.replaceAll('_', ' ')}`
                        : ''}{' '}
                      · {refund.reason}
                    </p>

                    {refund.providerReference ? (
                      <p>Provider reference: {refund.providerReference}</p>
                    ) : null}

                    {[
                      'REQUESTED',
                      'DISPUTED',
                      'ELIGIBLE',
                      'PENDING',
                    ].includes(refund.status) ? (
                      <div className="appointment-refund-actions">
                        <button
                          type="button"
                          disabled={actingId === appointment.id}
                          onClick={() =>
                            void reviewRefund(appointment, refund.id, 'PENDING')
                          }
                        >
                          Mark processing
                        </button>
                        <button
                          type="button"
                          disabled={actingId === appointment.id}
                          onClick={() =>
                            void reviewRefund(appointment, refund.id, 'REFUNDED')
                          }
                        >
                          Record refund
                        </button>
                        <button
                          type="button"
                          disabled={actingId === appointment.id}
                          onClick={() =>
                            void reviewRefund(appointment, refund.id, 'DISPUTED')
                          }
                        >
                          Escalate dispute
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}

                {appointment.reason && <p>Reason: {appointment.reason}</p>}

                <div>
                  {(actions[appointment.status] ?? []).map((action) => (
                    <button
                      key={action.status}
                      type="button"
                      disabled={actingId === appointment.id}
                      onClick={() => void runAction(appointment, action.status)}
                    >
                      {actingId === appointment.id
                        ? 'Updating…'
                        : action.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <button
        className="appointments-open-encounters"
        type="button"
        onClick={() => onNavigate('/tenant/encounters')}
      >
        Open encounters
      </button>
    </section>
  );
}
