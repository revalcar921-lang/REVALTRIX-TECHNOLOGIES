import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, LocateFixed, MapPin, RefreshCw, Search } from 'lucide-react';
import { authenticatedApiRequest } from '../../../lib/auth-api.js';
import {
  createAppointmentSlotHold,
  discoverAppointmentFacilities,
  discoverAppointmentSlots,
  getAppointmentPaymentStatus,
  getPatientBookingEligibility,
  initiateAppointmentDeposit,
  requestAppointmentRefund,
} from '../../appointments/api/appointments.api.js';
import type {
  AppointmentFacility,
  AppointmentSlot,
} from '../../appointments/types/appointment.types.js';
import { AppointmentDiscoveryMap, type AppointmentMapLocation } from '../../appointments/components/AppointmentDiscoveryMap.js';
import { distanceKm, validCoordinate } from '../../appointments/api/appointment-discovery.utils.js';
import './PatientAppointmentsSection.css';

interface PatientAppointment {
  id: string;
  appointmentNumber: string;
  status: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  reason: string | null;
  paymentIntents?: Array<{ status: string; amount: string; currency: string; providerReceipt: string | null }>;
  refunds?: Array<{ id: string; status: string; reason: string; amount: string; currency: string }>;
  tenant: { id: string; name: string; legalName: string | null };
  branch: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  service: { id: string; name: string; code: string } | null;
  provider: { professionalTitle: string | null; specialty: string | null } | null;
}

function formatStatus(status: string): string {
  return status.replaceAll('_', ' ').toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function PatientAppointmentsSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [appointments, setAppointments] = useState<PatientAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [facilities, setFacilities] = useState<AppointmentFacility[]>([]);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesError, setFacilitiesError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [discoverySearch, setDiscoverySearch] = useState('');
  const [patientLocation, setPatientLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    return new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  });
  const [visitReason, setVisitReason] = useState('');
  const [slotHold, setSlotHold] = useState<{ id: string; expiresAt: string } | null>(null);
  const [depositPhone, setDepositPhone] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState<string | null>(null);
  const [refundSubmittingId, setRefundSubmittingId] = useState<string | null>(null);
  const [holdIdempotencyKey, setHoldIdempotencyKey] = useState(() => crypto.randomUUID());
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => crypto.randomUUID());
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AppointmentSlot | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await authenticatedApiRequest<PatientAppointment[]>(
        '/v1/appointments/my',
      );
      setAppointments(result);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to load your appointments.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFacilities = useCallback(async (search?: string) => {
    setFacilitiesLoading(true);
    setFacilitiesError(null);
    try {
      const result = await discoverAppointmentFacilities(search);
      setFacilities(result);
    } catch (requestError) {
      setFacilitiesError(
        getErrorMessage(requestError, 'Unable to discover bookable facilities.'),
      );
    } finally {
      setFacilitiesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAppointments();
    void loadFacilities();
  }, [loadAppointments, loadFacilities]);

  useEffect(() => {
    if (!paymentIntentId) return;
    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const status = await getAppointmentPaymentStatus(paymentIntentId);
        if (cancelled) return;
        setPaymentStatus(status.status);
        if (status.status === 'SUCCEEDED' && status.appointment) {
          setBookingSuccess(`Deposit confirmed. Appointment ${status.appointment.appointmentNumber} is ${formatStatus(status.appointment.status)} and awaits facility confirmation.`);
          await loadAppointments();
        }
      } catch (statusError) {
        if (!cancelled) setBookingError(getErrorMessage(statusError, 'Unable to refresh payment status.'));
      }
    };
    void refreshStatus();
    const timer = window.setInterval(() => { void refreshStatus(); }, 4_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [paymentIntentId, loadAppointments]);

  const selectedFacility = facilities.find((facility) => facility.id === tenantId);
  const selectedBranch = selectedFacility?.branches.find((branch) => branch.id === branchId);
  const availableDepartments = selectedFacility?.departments.filter(
    (department) => !department.branchId || department.branchId === branchId,
  ) ?? [];
  const availableDepartmentIds = new Set(availableDepartments.map((department) => department.id));
  const availableServices = selectedFacility?.services.filter(
    (service) =>
      (!service.branchId || service.branchId === branchId) &&
      (!service.departmentId ||
        !departmentId ||
        service.departmentId === departmentId),
  ) ?? [];
  const selectedService = availableServices.find((service) => service.id === serviceId);
  const sortedFacilities = useMemo(() => facilities
    .map((facility) => {
      const distances = facility.branches.flatMap((branch) => {
        const latitude = validCoordinate(branch.latitude);
        const longitude = validCoordinate(branch.longitude);
        return patientLocation && latitude !== null && longitude !== null
          ? [distanceKm(patientLocation, { latitude, longitude })]
          : [];
      });
      return { facility, distance: distances.length ? Math.min(...distances) : null };
    })
    .sort((left, right) => {
      if (left.distance === null) return right.distance === null ? left.facility.name.localeCompare(right.facility.name) : 1;
      if (right.distance === null) return -1;
      return left.distance - right.distance;
    }), [facilities, patientLocation]);
  const mapLocations: AppointmentMapLocation[] = useMemo(() => sortedFacilities.flatMap(({ facility }) =>
    facility.branches.flatMap((branch) => {
      const latitude = validCoordinate(branch.latitude);
      const longitude = validCoordinate(branch.longitude);
      return latitude !== null && longitude !== null ? [{
        tenantId: facility.id,
        branchId: branch.id,
        name: facility.profile?.businessName || facility.name,
        address: [branch.address, branch.town, branch.county].filter(Boolean).join(', '),
        latitude,
        longitude,
      }] : [];
    }),
  ), [sortedFacilities]);

  function resetSlotSearch() {
    setSlots([]);
    setSelectedSlot(null);
    setSlotsError(null);
    setBookingError(null);
    setBookingSuccess(null);
  }

  const selectFacility = useCallback((nextTenantId: string) => {
    const facility = facilities.find((item) => item.id === nextTenantId);
    const branch = facility?.branches.length === 1 ? facility.branches[0] : undefined;
    const departments = facility?.departments.filter(
      (department) => !department.branchId || department.branchId === branch?.id,
    ) ?? [];
    setTenantId(nextTenantId);
    setBranchId(branch?.id ?? '');
    setDepartmentId(departments.length === 1 ? departments[0]!.id : '');
    setServiceId('');
    resetSlotSearch();
  }, [facilities]);

  function requestPatientLocation(): void {
    if (!navigator.geolocation) {
      setLocationMessage('Location is unavailable in this browser. Search by town, address, or branch instead.');
      return;
    }
    setLocationMessage('Waiting for your location permission…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPatientLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationMessage('Nearby results are sorted using your current location.');
      },
      () => setLocationMessage('Location was not shared. Search by town, address, or branch instead.'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function submitDiscoverySearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const search = searchInput.trim();
    setDiscoverySearch(search);
    selectFacility('');
    void loadFacilities(search || undefined);
  }

  async function searchSlots() {
    if (!selectedFacility || !selectedService || !branchId || !departmentId) {
      setSlotsError('Choose a facility, branch, department, and service first.');
      return;
    }

    setSlotsLoading(true);
    setSlotsError(null);
    setBookingError(null);
    setBookingSuccess(null);
    setSlots([]);
    setSelectedSlot(null);

    try {
      const from = new Date(`${startDate}T00:00:00`);
      if (!Number.isFinite(from.getTime()) || from < new Date(new Date().setHours(0, 0, 0, 0))) {
        setSlotsError('Choose today or a future date to search availability.');
        return;
      }
      const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);

      const result = await discoverAppointmentSlots({
        tenantId: selectedFacility.id,
        serviceId: selectedService.id,
        from: from.toISOString(),
        to: to.toISOString(),
        branchId: selectedService.branchId ?? branchId,
        departmentId: selectedService.departmentId ?? departmentId,
      });

      setSlots(result);
      if (result.length === 0) {
        setSlotsError(
          'No available slots were found in the next 14 days. Try again later or choose another service.',
        );
      }
    } catch (requestError) {
      setSlotsError(getErrorMessage(requestError, 'Unable to load available slots.'));
    } finally {
      setSlotsLoading(false);
    }
  }

  async function reserveSlotForDeposit() {
    if (!selectedFacility || !selectedService || !selectedSlot) {
      setBookingError('Choose an available appointment time first.');
      return;
    }

    setBooking(true);
    setBookingError(null);
    setBookingSuccess(null);
    try {
      const eligibility = await getPatientBookingEligibility(selectedFacility.id);
      if (!eligibility.canBook) {
        const messages: Record<string, string> = {
          PATIENT_PROFILE_REQUIRED: 'Complete your patient profile before booking.',
          ACCOUNT_INACTIVE: 'Your account is inactive. Contact support before booking.',
          IDENTITY_VERIFICATION_REQUIRED: 'Verify your account identity before booking.',
          FACILITY_NOT_BOOKABLE: 'This facility is not currently accepting online appointments.',
          FACILITY_REGISTRATION_PENDING: 'Your registration with this facility is still pending.',
          FACILITY_REGISTRATION_REQUIRED: 'Register with this facility before booking.',
        };
        setBookingError(messages[eligibility.reason ?? ''] ?? 'Your account is not eligible to book at this facility.');
        return;
      }
      const hold = await createAppointmentSlotHold({
        tenantId: selectedFacility.id,
        serviceId: selectedService.id,
        providerId: selectedSlot.providerId,
        branchId: selectedSlot.branchId ?? branchId,
        ...(selectedSlot.departmentId ? { departmentId: selectedSlot.departmentId } : {}),
        startAt: selectedSlot.startAt,
        endAt: selectedSlot.endAt,
        timeZone: selectedSlot.timeZone,
        ...(visitReason.trim() ? { reason: visitReason.trim() } : {}),
        idempotencyKey: holdIdempotencyKey,
      });
      setSlotHold({ id: hold.id, expiresAt: hold.expiresAt });
      setPaymentStatus(null);
      setPaymentIntentId('');
      setPaymentReference(null);
      setPaymentIdempotencyKey(crypto.randomUUID());
    } catch (requestError) {
      setBookingError(
        getErrorMessage(
          requestError,
          'Booking could not be completed. Check your facility registration and selected slot.',
        ),
      );
    } finally {
      setBooking(false);
    }
  }

  async function payAppointmentDeposit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slotHold) return;
    setBooking(true);
    setBookingError(null);
    setBookingSuccess(null);
    try {
      const payment = await initiateAppointmentDeposit(slotHold.id, {
        phoneNumber: depositPhone,
        idempotencyKey: paymentIdempotencyKey,
      });
      setPaymentIntentId(payment.paymentIntentId);
      setPaymentReference(payment.reference);
      setPaymentStatus(payment.status);
    } catch (requestError) {
      setBookingError(getErrorMessage(requestError, 'Unable to start M-Pesa payment. The appointment was not booked.'));
    } finally {
      setBooking(false);
    }
  }

  const now = Date.now();
  const upcoming = appointments.filter(
    (appointment) =>
      new Date(appointment.startAt).getTime() >= now &&
      !['CANCELLED', 'REJECTED', 'NO_SHOW', 'COMPLETED'].includes(
        appointment.status,
      ),
  );
  const past = appointments.filter((appointment) => !upcoming.includes(appointment));

  function renderAppointment(appointment: PatientAppointment) {
    const providerLabel = [
      appointment.provider?.professionalTitle,
      appointment.provider?.specialty,
    ].filter(Boolean).join(' · ');

    return (
      <article className="patient-dashboard-facility-card" key={appointment.id}>
        <div className="patient-dashboard-facility-meta">
          <strong>
            {appointment.service?.name ??
              appointment.department?.name ??
              'Healthcare appointment'}
          </strong>
          <span>{appointment.tenant.name}</span>
          {appointment.branch && <span>Branch: {appointment.branch.name}</span>}
          {appointment.department && appointment.service && (
            <span>Department: {appointment.department.name}</span>
          )}
          {providerLabel && <span>{providerLabel}</span>}
          <span>{formatDate(appointment.startAt, appointment.timeZone)}</span>
          <span>Status: {formatStatus(appointment.status)}</span>
          <span>Reference: {appointment.appointmentNumber}</span>
          {appointment.paymentIntents?.[0] ? <span>Deposit: {appointment.paymentIntents[0].currency} {appointment.paymentIntents[0].amount} · {appointment.paymentIntents[0].status.replaceAll('_', ' ')}{appointment.paymentIntents[0].providerReceipt ? ` · Receipt ${appointment.paymentIntents[0].providerReceipt}` : ''}</span> : null}
          {appointment.refunds?.map((refund) => <span key={refund.id}>Refund: {refund.status.replaceAll('_', ' ')} · {refund.reason}</span>)}
          {appointment.reason && <span>Reason: {appointment.reason}</span>}
          {appointment.paymentIntents?.some((payment) => payment.status === 'SUCCEEDED') &&
            ['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(appointment.status) &&
            !appointment.refunds?.some((refund) => !['FAILED', 'NOT_ELIGIBLE'].includes(refund.status)) ? (
              <button
                type="button"
                disabled={refundSubmittingId === appointment.id}
                onClick={() => {
                  const reason = window.prompt(appointment.status === 'NO_SHOW' ? 'Explain why you are disputing the no-show decision:' : 'Reason for requesting a deposit refund:');
                  if (!reason?.trim()) return;
                  setRefundSubmittingId(appointment.id);
                  void requestAppointmentRefund(appointment.id, reason.trim())
                    .then(() => loadAppointments())
                    .catch((refundError: unknown) => setError(getErrorMessage(refundError, 'Unable to request refund.')))
                    .finally(() => setRefundSubmittingId(null));
                }}
              >
                {refundSubmittingId === appointment.id ? 'Submitting…' : appointment.status === 'NO_SHOW' ? 'Dispute no-show / request refund' : 'Request deposit refund'}
              </button>
            ) : null}
        </div>
      </article>
    );
  }

  return (
    <section className="patient-dashboard-section patient-patient-content-panel">
      <div className="patient-dashboard-section-header">
        <div>
          <p className="patient-dashboard-eyebrow">YOUR CARE</p>
          <h1>Appointments</h1>
          <p>
            Discover facilities, request appointments, and follow your care
            across connected facilities.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAppointments()}
          disabled={loading}
          aria-label="Refresh appointments"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <section className="appointment-booking-workflow" aria-labelledby="appointment-booking-title">
        <div className="patient-dashboard-section-header">
          <div>
            <h2 id="appointment-booking-title">Find care nearby</h2>
            <p>Search facilities and public services, then choose a department and available appointment.</p>
          </div>
        </div>
        <form className="appointment-discovery-search" onSubmit={submitDiscoverySearch}>
          <label htmlFor="appointment-discovery-search">Service, facility, town, or address</label>
          <div>
            <input
              id="appointment-discovery-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              maxLength={160}
              placeholder="For example, cardiology or Westlands"
            />
            <button type="submit" disabled={facilitiesLoading} aria-label="Search facilities"><Search size={16} /> Search</button>
            <button type="button" onClick={requestPatientLocation} aria-label="Use my current location"><LocateFixed size={16} /> Nearby</button>
          </div>
          {locationMessage ? <p role="status">{locationMessage}</p> : null}
        </form>
        {facilitiesError ? <div className="patient-dashboard-empty" role="alert"><p>{facilitiesError}</p><button type="button" onClick={() => void loadFacilities(discoverySearch)}>Try again</button></div> : null}
        {facilitiesLoading ? <p role="status">Searching current bookable facilities…</p> : null}
        {!facilitiesLoading && !facilitiesError && facilities.length === 0 ? <p className="patient-dashboard-empty">No bookable facilities match this search. A facility appears here only when it is live, online booking is enabled, and its website has published at least one public branch and service. Saving website changes creates a draft; publish those updates before they appear here.</p> : null}
        {discoverySearch ? <p className="appointment-discovery-query">Results for “{discoverySearch}”</p> : null}
        <AppointmentDiscoveryMap locations={mapLocations} selectedTenantId={tenantId} onSelectTenant={selectFacility} />
        {sortedFacilities.length ? (
          <div className="appointment-facility-results" aria-label="Bookable facilities">
            {sortedFacilities.map(({ facility, distance }) => (
              <button
                type="button"
                className={`appointment-facility-result ${tenantId === facility.id ? 'is-selected' : ''}`}
                key={facility.id}
                aria-pressed={tenantId === facility.id}
                onClick={() => selectFacility(facility.id)}
              >
                <span className="appointment-facility-result-icon"><MapPin size={18} /></span>
                <span className="appointment-facility-result-copy">
                  <strong>{facility.profile?.businessName || facility.name}</strong>
                  <small>{[...new Set(facility.branches.map((branch) => [branch.town, branch.county].filter(Boolean).join(', ')).filter(Boolean))].join(' · ') || 'Location details not configured'}</small>
                  <small>{facility.departments.length} departments · {facility.services.length} bookable services</small>
                </span>
                {distance !== null ? <span className="appointment-facility-distance">{distance < 10 ? distance.toFixed(1) : Math.round(distance)} km</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {selectedFacility ? (
        <section className="appointment-booking-step" aria-labelledby="appointment-selection-title">
          <div className="appointment-step-heading"><span>2</span><div><h2 id="appointment-selection-title">Choose a branch, department, and service</h2><p>{selectedFacility.profile?.businessName || selectedFacility.name}</p></div></div>
          <div className="appointment-selection-grid">
            <label>Branch
              <select value={branchId} onChange={(event) => { const nextBranchId = event.target.value; const departments = selectedFacility.departments.filter((department) => !department.branchId || department.branchId === nextBranchId); setBranchId(nextBranchId); setDepartmentId(departments.length === 1 ? departments[0]!.id : ''); setServiceId(''); resetSlotSearch(); }} required>
                <option value="">Choose a branch</option>
                {selectedFacility.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {[branch.address, branch.town, branch.county].filter(Boolean).join(', ') || 'Address not configured'}</option>)}
              </select>
            </label>
            <label>Department
            <select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setServiceId(''); resetSlotSearch(); }} disabled={!branchId} required>
              <option value="">Choose a department</option>
              {availableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
            <label>Service
            <select value={serviceId} onChange={(event) => { setServiceId(event.target.value); resetSlotSearch(); }} disabled={!branchId || !departmentId} required>
              <option value="">Choose a service</option>
              {availableServices.map((service) => <option key={service.id} value={service.id}>{service.name}{service.durationMin ? ` · ${service.durationMin} min` : ''}</option>)}
              </select>
            </label>
            <label>Start date
              <input type="date" value={startDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => { setStartDate(event.target.value); resetSlotSearch(); }} />
            </label>
            <label className="appointment-reason-field">Reason for visit <span>(optional)</span>
              <input value={visitReason} onChange={(event) => setVisitReason(event.target.value)} maxLength={500} placeholder="Share only what is needed to arrange this visit" />
            </label>
          </div>
          {selectedBranch ? <p className="appointment-selected-branch">{[selectedBranch.address, selectedBranch.town, selectedBranch.county].filter(Boolean).join(', ') || 'Branch address not configured'}{selectedBranch.openingTime && selectedBranch.closingTime ? ` · ${selectedBranch.openingTime}–${selectedBranch.closingTime}` : ''}</p> : null}
          {selectedFacility.branches.length > 1 && !branchId ? <p className="appointment-form-hint">Select the branch you intend to visit. Each branch has its own location and availability.</p> : null}
          {selectedFacility.branches.length === 0 ? <p className="appointment-form-hint is-error">This facility has no active branches configured and cannot be booked online.</p> : null}
          {selectedService?.description ? <p className="appointment-form-hint">{selectedService.description}</p> : null}
          {selectedBranch && availableDepartments.length === 0 ? <p className="appointment-form-hint is-error">No public appointment departments are configured for this branch.</p> : null}
          <button type="button" className="appointment-search-slots" onClick={() => void searchSlots()} disabled={!selectedService || !branchId || !departmentId || slotsLoading || booking}>
            {slotsLoading ? 'Checking live availability…' : 'Find available times'}
          </button>
        </section>
      ) : null}

      {slotsError && (
        <div className="patient-dashboard-empty" role="alert">
          <p>{slotsError}</p>
        </div>
      )}

      {slots.length > 0 && (
        <section className="appointment-booking-step" aria-labelledby="appointment-time-title">
          <div className="appointment-step-heading"><span>3</span><div><h2 id="appointment-time-title">Choose a time</h2><p>Availability is checked against the facility’s current schedule.</p></div></div>
          <p>Times are shown in the provider’s configured time zone.</p>
          <div className="patient-dashboard-request-list">
            {slots.map((slot) => {
              const selected =
                selectedSlot?.providerId === slot.providerId &&
                selectedSlot?.startAt === slot.startAt;

              return (
                <button
                  type="button"
                  key={`${slot.providerId}:${slot.startAt}`}
                  className={`appointment-slot-option ${selected ? 'is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => {
                    setSelectedSlot(slot);
                    setHoldIdempotencyKey(crypto.randomUUID());
                    setPaymentIdempotencyKey(crypto.randomUUID());
                    setBookingError(null);
                    setBookingSuccess(null);
                  }}
                  disabled={booking}
                >
                  <div className="patient-dashboard-facility-meta">
                    <strong>{formatDate(slot.startAt, slot.timeZone)}</strong>
                    <span>
                      {selectedFacility?.departments.find((department) => department.id === slot.departmentId)?.name ?? 'Available department'}
                    </span>
                    {selected && <span className="appointment-slot-selected">Selected</span>}
                  </div>
                </button>
              );
            })}
          </div>
          {selectedSlot && (
            <div className="appointment-selected-time">
              <strong>{formatDate(selectedSlot.startAt, selectedSlot.timeZone)}</strong>
              <span>{selectedFacility?.departments.find((department) => department.id === selectedSlot.departmentId)?.name ?? 'Department appointment'}</span>
              <button
                type="button"
                onClick={() => void reserveSlotForDeposit()}
                disabled={booking}
              >
                {booking ? 'Checking eligibility…' : 'Continue to deposit'}
              </button>
            </div>
          )}
        </section>
      )}

      {bookingError?.includes('Verify your account identity') || bookingError?.includes('Register with this facility') || bookingError?.includes('registration with this facility') ? (
        <div className="appointment-eligibility-guidance" role="alert">
          <p>{bookingError}</p>
          <button type="button" onClick={() => onNavigate(bookingError.includes('Verify') ? '/patient/profile' : '/patient/facilities')}>
            {bookingError.includes('Verify') ? 'Open patient profile' : 'Review facility registration'}
          </button>
        </div>
      ) : null}

      {slotHold && !paymentIntentId ? (
        <section className="appointment-deposit-panel" aria-labelledby="appointment-deposit-title">
          <div className="appointment-step-heading"><span>4</span><div><h2 id="appointment-deposit-title">Confirm your deposit</h2><p>{selectedFacility?.profile?.businessName || selectedFacility?.name} · {selectedBranch?.name}</p></div></div>
          <div className="appointment-deposit-amount"><span>Booking deposit</span><strong>KSh 100</strong></div>
          <p>The facility handles deposit refunds in person. Revaltrix is not configured to automatically return this payment through M-Pesa. Confirm the facility’s refund timing and conditions before paying. Keep your M-Pesa receipt for reference.</p>
          <form onSubmit={(event) => void payAppointmentDeposit(event)}>
            <label htmlFor="appointment-deposit-phone">M-Pesa phone number</label>
            <input id="appointment-deposit-phone" type="tel" inputMode="tel" autoComplete="tel" value={depositPhone} onChange={(event) => setDepositPhone(event.target.value)} placeholder="0712345678 or +254712345678" required maxLength={16} />
            <label className="appointment-deposit-consent"><input type="checkbox" required /> I understand the deposit is KSh 100 and that any refund is handled by the facility, not automatically by Revaltrix.</label>
            <p className="appointment-hold-expiry">This slot is held until {new Date(slotHold.expiresAt).toLocaleTimeString()} while payment is pending.</p>
            <button type="submit" disabled={booking || (Date.parse(slotHold.expiresAt) <= Date.now())}>{booking ? 'Sending STK prompt…' : 'Send M-Pesa payment prompt'}</button>
          </form>
        </section>
      ) : null}

      {paymentIntentId ? (
        <section className="appointment-payment-status" aria-live="polite">
          <div className="appointment-step-heading"><span>5</span><div><h2>M-Pesa payment status</h2><p>Reference {paymentReference}</p></div></div>
          {paymentStatus === 'PENDING' ? <p>Approve the KSh 100 prompt on your phone. Do not submit another payment; this page checks the verified provider status.</p> : null}
          {paymentStatus === 'RECONCILIATION_REQUIRED' ? <p role="alert">The provider has not confirmed the final payment result yet. Do not retry or pay again. Your request is being reconciled; contact the facility with reference {paymentReference} if this status persists.</p> : null}
          {paymentStatus === 'FAILED' || paymentStatus === 'EXPIRED' ? <p role="alert">No confirmed payment or appointment was recorded. Start again and select a fresh available time.</p> : null}
          {paymentStatus === 'SUCCEEDED' ? <p role="status">Payment verified. Your appointment request is recorded and will appear in your appointments.</p> : null}
        </section>
      ) : null}

      {bookingError && (
        <div className="patient-dashboard-empty" role="alert">
          <h2>Booking could not be completed</h2>
          <p>{bookingError}</p>
          <p>
            If you are not registered with this facility, complete its patient
            registration process before booking. Your facility relationship
            will not be activated automatically.
          </p>
        </div>
      )}

      {bookingSuccess && (
        <div className="patient-dashboard-empty" role="status">
          <h2>Appointment request submitted</h2>
          <p>{bookingSuccess}</p>
        </div>
      )}

      <div className="patient-dashboard-section-header">
        <h2>Your upcoming appointments</h2>
        <span className="patient-dashboard-count">{upcoming.length}</span>
      </div>

      {loading ? (
        <div className="patient-dashboard-empty"><p>Loading your appointments…</p></div>
      ) : error ? (
        <div className="patient-dashboard-empty" role="alert">
          <h2>Could not load appointments</h2>
          <p>{error}</p>
          <button type="button" onClick={() => void loadAppointments()}>Try again</button>
        </div>
      ) : (
        <>
          {upcoming.length ? (
            <div className="patient-dashboard-request-list">
              {upcoming.map(renderAppointment)}
            </div>
          ) : (
            <div className="patient-dashboard-empty">
              <CalendarDays size={28} />
              <p>You have no upcoming appointments.</p>
            </div>
          )}

          <div className="patient-dashboard-section-header">
            <h2>Previous and other appointments</h2>
            <span className="patient-dashboard-count">{past.length}</span>
          </div>
          {past.length ? (
            <div className="patient-dashboard-request-list">
              {past.map(renderAppointment)}
            </div>
          ) : (
            <div className="patient-dashboard-empty">
              <p>No previous appointments to show.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
