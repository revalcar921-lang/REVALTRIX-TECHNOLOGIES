import { useEffect, useState } from 'react';
import './PatientsPage.css';
import {
  enrollPatient,
  findExistingPatient,
  getPatient,
  getPatients,
  registerPatient,
  sendPatientRegistrationCode,
  verifyPatientRegistrationAsStaff,
} from '../api/patients.api.js';
import type {
  PatientDetail,
  PatientListItem,
  PatientRecordStatus,
} from '../types/patient.types.js';

interface PatientsPageProps {
  onNavigate: (path: string) => void;
}

const PAGE_SIZE = 25;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function statusLabel(status: PatientRecordStatus): string {
  return status.replace('_', ' ');
}

export function PatientsPage({ onNavigate }: PatientsPageProps) {
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [selectedPatient, setSelectedPatient] =
    useState<PatientDetail | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] =
    useState<'ALL' | PatientRecordStatus>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [enrollmentPlatformPatientId, setEnrollmentPlatformPatientId] =
    useState('');
  const [enrollmentPatientNumber, setEnrollmentPatientNumber] = useState('');
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [enrollmentSuccess, setEnrollmentSuccess] = useState<string | null>(
    null,
  );

  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationFirstName, setRegistrationFirstName] = useState('');
  const [registrationSecondName, setRegistrationSecondName] = useState('');
  const [registrationEmail, setRegistrationEmail] = useState('');
  const [registrationPhone, setRegistrationPhone] = useState('');
  const [registrationLocation, setRegistrationLocation] = useState('');
  const [registrationPatientNumber, setRegistrationPatientNumber] =
    useState('');
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(
    null,
  );
  const [registrationSuccess, setRegistrationSuccess] = useState<string | null>(
    null,
  );
  const [registrationChallengeId, setRegistrationChallengeId] =
    useState<string | null>(null);

  const [verificationCode, setVerificationCode] = useState('');
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationSendLoading, setVerificationSendLoading] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  );
  const [verificationSuccess, setVerificationSuccess] = useState<string | null>(
    null,
  );

  const [existingPatient, setExistingPatient] =
    useState<Awaited<ReturnType<typeof findExistingPatient>> | null>(null);
  const [existingPatientLoading, setExistingPatientLoading] =
    useState(false);
  const [existingPatientError, setExistingPatientError] =
    useState<string | null>(null);
  const [existingPatientPatientNumber, setExistingPatientPatientNumber] =
    useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadPatients(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const result = await getPatients({
          search,
          status,
          page,
          pageSize: PAGE_SIZE,
        });

        if (cancelled) {
          return;
        }

        setPatients(result.data);
        setTotal(result.pagination.total);
        setTotalPages(Math.max(result.pagination.totalPages, 1));
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load patients.',
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPatients();

    return () => {
      cancelled = true;
    };
  }, [search, status, page, reloadKey]);

  async function openPatient(patientRecordId: string): Promise<void> {
    setSelectedPatient(null);
    setDetailError(null);
    setRegistrationChallengeId(null);
    setVerificationCode('');
    setVerificationError(null);
    setVerificationSuccess(null);
    setDetailLoading(true);

    try {
      const result = await getPatient(patientRecordId);
      setSelectedPatient(result);
    } catch (requestError) {
      setDetailError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load patient details.',
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSendPatientVerificationCode(): Promise<void> {
    if (!selectedPatient) {
      return;
    }

    setVerificationSendLoading(true);
    setVerificationError(null);
    setVerificationSuccess(null);

    try {
      const result = await sendPatientRegistrationCode(selectedPatient.id);
      setRegistrationChallengeId(result.challengeId);
      setVerificationCode('');
      setVerificationSuccess(`A verification code was sent to ${result.target}.`);
    } catch (requestError) {
      setVerificationError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to send a verification code.',
      );
    } finally {
      setVerificationSendLoading(false);
    }
  }

  function openEnrollment(): void {
    setEnrollmentOpen(true);
    setEnrollmentError(null);
    setEnrollmentSuccess(null);
  }

  function closeEnrollment(): void {
    if (enrollmentLoading) {
      return;
    }

    setEnrollmentOpen(false);
    setEnrollmentError(null);
    setEnrollmentSuccess(null);
    setEnrollmentPlatformPatientId('');
    setEnrollmentPatientNumber('');
  }

  async function handleEnrollmentSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const platformPatientId = enrollmentPlatformPatientId.trim();
    const patientNumber = enrollmentPatientNumber.trim();

    if (!platformPatientId) {
      setEnrollmentError(
        'Revaltrix Patient ID is required.',
      );
      return;
    }

    setEnrollmentLoading(true);
    setEnrollmentError(null);
    setEnrollmentSuccess(null);

    try {
      const result = await enrollPatient({
        platformPatientId,
        patientNumber,
      });

      setEnrollmentSuccess(
        `Relationship request created for ${result.patient.displayName}. The patient must approve the request before the relationship becomes active.`,
      );
      setEnrollmentPlatformPatientId('');
      setEnrollmentPatientNumber('');
      setPage(1);
      setReloadKey((current) => current + 1);
    } catch (requestError) {
      setEnrollmentError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to register patient.',
      );
    } finally {
      setEnrollmentLoading(false);
    }
  }

  async function handleExistingPatientLookup(
    identifier = registrationEmail.trim() || registrationPhone.trim(),
  ): Promise<void> {

    if (!identifier) {
      setExistingPatientError(
        'Enter the patient email address or phone number to find the existing Revaltrix patient.',
      );
      return;
    }

    setExistingPatientLoading(true);
    setExistingPatientError(null);
    setExistingPatient(null);

    try {
      const result = await findExistingPatient(identifier);

      setExistingPatient(result);

      if (result.existingFacilityRecord?.patientNumber) {
        setExistingPatientPatientNumber(
          result.existingFacilityRecord.patientNumber,
        );
      } else {
        setExistingPatientPatientNumber(registrationPatientNumber.trim());
      }
    } catch (requestError) {
      setExistingPatientError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to find the existing Revaltrix patient.',
      );
    } finally {
      setExistingPatientLoading(false);
    }
  }

  async function handleExistingPatientEnrollment(): Promise<void> {
    if (!existingPatient) {
      return;
    }

    const patientNumber = existingPatientPatientNumber.trim();

    setExistingPatientLoading(true);
    setExistingPatientError(null);

    try {
      const result = await enrollPatient({
        platformPatientId:
          existingPatient.patient.platformPatientId,
        patientNumber,
      });

      setExistingPatientPatientNumber('');
      setExistingPatient(null);

      setEnrollmentSuccess(
        `Relationship request created for ${result.patient.displayName}. The patient must approve the request before the relationship becomes active.`,
      );

      setReloadKey((current) => current + 1);
    } catch (requestError) {
      setExistingPatientError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to enroll the existing Revaltrix patient.',
      );
    } finally {
      setExistingPatientLoading(false);
    }
  }

  async function handlePatientVerification(): Promise<void> {
    const challengeId = registrationChallengeId;
    const code = verificationCode.trim();

    if (!challengeId) {
      setVerificationError(
        'No verification challenge is available for this patient. Start a new verification workflow.',
      );
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setVerificationError('Enter the 6-digit verification code.');
      return;
    }

    setVerificationLoading(true);
    setVerificationError(null);
    setVerificationSuccess(null);

    try {
      const result = await verifyPatientRegistrationAsStaff(
        challengeId,
        code,
      );

      setVerificationSuccess(
        `Patient ${result.patientRecord.patientNumber} has been verified and is now ACTIVE.`,
      );
      setVerificationCode('');

      setReloadKey((current) => current + 1);

      await openPatient(result.patientRecord.id);

      setVerificationSuccess(
        `Patient ${result.patientRecord.patientNumber} has been verified and is now ACTIVE.`,
      );
    } catch (requestError) {
      setVerificationError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to verify patient identity.',
      );
    } finally {
      setVerificationLoading(false);
    }
  }

  function openRegistration(): void {
    setRegistrationOpen(true);
    setRegistrationError(null);
    setRegistrationSuccess(null);
    setRegistrationChallengeId(null);
    setExistingPatient(null);
    setExistingPatientError(null);
    setExistingPatientPatientNumber('');
  }

  function closeRegistration(): void {
    if (registrationLoading) {
      return;
    }

    setRegistrationOpen(false);
    setRegistrationError(null);
    setRegistrationSuccess(null);
    setRegistrationChallengeId(null);
    setExistingPatient(null);
    setExistingPatientError(null);
    setExistingPatientPatientNumber('');
    setRegistrationFirstName('');
    setRegistrationSecondName('');
    setRegistrationEmail('');
    setRegistrationPhone('');
    setRegistrationLocation('');
    setRegistrationPatientNumber('');
  }

  async function handleRegistrationSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const firstName = registrationFirstName.trim();
    const secondName = registrationSecondName.trim();
    const email = registrationEmail.trim().toLowerCase();
    const phone = registrationPhone.trim();
    const location = registrationLocation.trim();

    if (!firstName || !secondName) {
      setRegistrationError(
        'First name and second name are required.',
      );
      return;
    }

    if (!email) {
      setRegistrationError(
        'Patient email is required for registration verification.',
      );
      return;
    }

    setRegistrationLoading(true);
    setRegistrationError(null);
    setRegistrationSuccess(null);
    setRegistrationChallengeId(null);

    try {
      const result = await registerPatient({
        firstName,
        secondName,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(location ? { location } : {}),
        verificationChannel: 'EMAIL',
      });

      setRegistrationSuccess(
        `${firstName} ${secondName} was registered with patient number ${result.patientNumber}. A verification code has been sent to ${email}.`,
      );
      setRegistrationChallengeId(result.verification.challengeId);
      setVerificationCode('');
      setVerificationError(null);
      setVerificationSuccess(null);

      setRegistrationFirstName('');
      setRegistrationSecondName('');
      setRegistrationEmail('');
      setRegistrationPhone('');
      setRegistrationLocation('');
      setRegistrationPatientNumber('');

      setPage(1);
      setStatus('ALL');
      setReloadKey((current) => current + 1);

      await openPatient(result.patientRecordId);
      setRegistrationChallengeId(result.verification.challengeId);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Unable to register patient.';

      if (
        message.toLowerCase().includes('email is already registered') ||
        message.toLowerCase().includes('phone is already registered')
      ) {
        setRegistrationError(null);
        setExistingPatientError(null);
        setExistingPatient(null);

        const duplicateIsPhone = message
          .toLowerCase()
          .includes('phone is already registered');
        const identifier = duplicateIsPhone ? phone : email || phone;
        await handleExistingPatientLookup(identifier);
      } else {
        setRegistrationError(message);
      }
    } finally {
      setRegistrationLoading(false);
    }
  }

  function handleSearch(value: string): void {
    setSearch(value);
    setPage(1);
  }

  function handleStatus(value: PatientRecordStatus): void {
    setStatus(value);
    setPage(1);
    setSelectedPatient(null);
  }

  return (
    <main className="tenant-page patient-management-page">
      <div className="tenant-page-header">
        <div>
          <p className="eyebrow">Patient management</p>
          <h1>Patients</h1>
          <p>
                    Manage facility relationships and operational records for Revaltrix patients.
          </p>
        </div>

        <div className="patient-page-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={openRegistration}
          >
            Register new patient
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() => onNavigate('/tenant/hospital')}
          >
            Back to dashboard
          </button>
        </div>
      </div>

      {(registrationOpen || enrollmentOpen) && (
        <section className="tenant-card">
          <div className="tenant-card-header">
            <div>
              <p className="eyebrow">Patient registration</p>
              <h2>Register a new patient</h2>
              <p>
                Create a pending patient record for this facility and
                start identity verification.
              </p>
            </div>

            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (registrationOpen) {
                  closeRegistration();
                } else {
                  closeEnrollment();
                }
              }}
              disabled={registrationLoading || enrollmentLoading}
            >
              Close
            </button>
          </div>

          {!registrationOpen && enrollmentOpen && (
            <div className="tenant-state">
              <p>
                Enroll an existing verified Revaltrix patient instead of
                creating a new patient identity.
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setEnrollmentOpen(false);
                  openRegistration();
                }}
              >
                Register new patient instead
              </button>
            </div>
          )}

          {registrationOpen && (
            <>
              <form
                onSubmit={(event) => void handleRegistrationSubmit(event)}
              >
                <div className="patient-filters">
                  <input
                    type="text"
                    value={registrationFirstName}
                    disabled={registrationLoading}
                    required
                    minLength={1}
                    maxLength={100}
                    placeholder="First name"
                    aria-label="Patient first name"
                    onChange={(event) =>
                      setRegistrationFirstName(event.target.value)
                    }
                  />

                  <input
                    type="text"
                    value={registrationSecondName}
                    disabled={registrationLoading}
                    required
                    minLength={1}
                    maxLength={100}
                    placeholder="Second name"
                    aria-label="Patient second name"
                    onChange={(event) =>
                      setRegistrationSecondName(event.target.value)
                    }
                  />

                  <input
                    type="email"
                    value={registrationEmail}
                    disabled={registrationLoading}
                    required
                    maxLength={320}
                    placeholder="Email address"
                    aria-label="Patient email address"
                    onChange={(event) =>
                      setRegistrationEmail(event.target.value)
                    }
                  />

                  <input
                    type="tel"
                    value={registrationPhone}
                    disabled={registrationLoading}
                    maxLength={30}
                    placeholder="Phone number (optional)"
                    aria-label="Patient phone number"
                    onChange={(event) =>
                      setRegistrationPhone(event.target.value)
                    }
                  />

                  <input
                    type="text"
                    value={registrationLocation}
                    disabled={registrationLoading}
                    maxLength={300}
                    placeholder="Location (optional)"
                    aria-label="Patient location"
                    onChange={(event) =>
                      setRegistrationLocation(event.target.value)
                    }
                  />

                  <div className="tenant-state" style={{ marginTop: 0 }}>
                    <p>
                      Patient number will be generated automatically from the tenant legal name and a 5-digit code.
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="secondary-button"
                    disabled={registrationLoading}
                  >
                    {registrationLoading
                      ? 'Registering...'
                      : 'Register patient'}
                  </button>
                </div>
              </form>

              <div className="tenant-state">
                <p>
                  Verification will be sent to the patient&apos;s email. The patient remains
                  <strong> PENDING </strong>
                  until identity verification is completed.
                </p>
              </div>

              {existingPatient && (
                <div className="tenant-card" style={{ marginTop: '1rem' }}>
                  <div className="tenant-card-header">
                    <div>
                      <p className="eyebrow">Existing Revaltrix patient found</p>
                      <h3>{existingPatient.patient.displayName}</h3>
                    </div>
                  </div>

                  <div className="patient-detail-grid">
                    <div>
                      <span>Revaltrix Patient ID</span>
                      <strong>{existingPatient.patient.platformPatientId}</strong>
                    </div>
                    <div>
                      <span>Location</span>
                      <strong>{existingPatient.patient.location ?? '—'}</strong>
                    </div>
                  </div>

                  {existingPatient.relationshipPending ? (
                    <div className="tenant-state">
                      <p>
                        Relationship request already pending. Waiting for patient approval.
                      </p>
                      {existingPatient.existingFacilityRecord && (
                        <p>
                          Facility patient number: {existingPatient.existingFacilityRecord.patientNumber}
                        </p>
                      )}
                    </div>
                  ) : existingPatient.alreadyRegisteredWithOrganization ? (
                    <div className="tenant-state">
                      <p>Patient already registered with this facility.</p>
                      {existingPatient.existingFacilityRecord && (
                        <p>
                          Facility record: {existingPatient.existingFacilityRecord.patientNumber}
                          {' · '}
                          {statusLabel(existingPatient.existingFacilityRecord.status)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="tenant-state">
                        <p>
                          This patient already has a Revaltrix identity. Request a relationship with this facility instead of creating a duplicate patient.
                        </p>
                      </div>

                      <div className="patient-filters">
                        <input
                          type="text"
                          value={existingPatientPatientNumber}
                          disabled={existingPatientLoading}
                          maxLength={50}
                          placeholder="Optional facility patient number"
                          aria-label="Facility patient number"
                          onChange={(event) =>
                            setExistingPatientPatientNumber(event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={existingPatientLoading}
                          onClick={() => void handleExistingPatientEnrollment()}
                        >
                          {existingPatientLoading
                            ? 'Requesting...'
                            : 'Enroll existing patient'}
                        </button>
                      </div>
                    </>
                  )}

                  {existingPatientError && (
                    <div className="tenant-state tenant-state-error">
                      <p>{existingPatientError}</p>
                    </div>
                  )}
                </div>
              )}

              {existingPatientError && !existingPatient && (
                <div className="tenant-state tenant-state-error">
                  <p>{existingPatientError}</p>
                </div>
              )}

              {registrationChallengeId && (
                <div className="tenant-card" style={{ marginTop: '1rem' }}>
                  <div className="tenant-card-header">
                    <div>
                      <p className="eyebrow">Identity verification</p>
                      <h3>Verify patient identity</h3>
                      <p>
                        Enter the 6-digit verification code sent to the
                        patient&apos;s email. Staff verification will activate
                        this facility patient record.
                      </p>
                    </div>
                  </div>

                  <div className="patient-filters">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={verificationCode}
                      disabled={verificationLoading}
                      maxLength={6}
                      placeholder="6-digit verification code"
                      aria-label="Patient verification code"
                      onChange={(event) =>
                        setVerificationCode(
                          event.target.value.replace(/\D/g, '').slice(0, 6),
                        )
                      }
                    />

                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        verificationLoading ||
                        !/^\d{6}$/.test(verificationCode)
                      }
                      onClick={() => void handlePatientVerification()}
                    >
                      {verificationLoading
                        ? 'Verifying...'
                        : 'Verify identity'}
                    </button>
                  </div>

                  {verificationError && (
                    <div className="tenant-state tenant-state-error">
                      <p>{verificationError}</p>
                    </div>
                  )}

                  {verificationSuccess && (
                    <div className="tenant-state">
                      <p>{verificationSuccess}</p>
                    </div>
                  )}
                </div>
              )}

              {registrationError && (
                <div className="tenant-state tenant-state-error">
                  <p>{registrationError}</p>
                </div>
              )}

              {registrationSuccess && (
                <div className="tenant-state">
                  <p>{registrationSuccess}</p>
                  {registrationChallengeId && (
                    <p>
                      Verification challenge created. Complete the patient
                      verification workflow using the code sent to the
                      patient&apos;s email.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {enrollmentOpen && (
            <div className="tenant-card" style={{ marginTop: '1rem' }}>
              <div className="tenant-card-header">
                <div>
                  <p className="eyebrow">Existing patient</p>
                  <h3>Enroll an existing Revaltrix patient</h3>
                  <p>
                    Match a verified platform identity and create this
                    organization&apos;s patient relationship.
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeEnrollment}
                  disabled={enrollmentLoading}
                >
                  Close enrollment
                </button>
              </div>

              <form onSubmit={(event) => void handleEnrollmentSubmit(event)}>
                <div className="patient-filters">
                  <input
                    type="text"
                    value={enrollmentPlatformPatientId}
                    disabled={enrollmentLoading}
                    required
                    minLength={3}
                    maxLength={50}
                    placeholder="Revaltrix Patient ID"
                    aria-label="Revaltrix Patient ID"
                    onChange={(event) =>
                      setEnrollmentPlatformPatientId(event.target.value)
                    }
                  />

                  <input
                    type="text"
                    value={enrollmentPatientNumber}
                    disabled={enrollmentLoading}
                    required
                    minLength={1}
                    maxLength={50}
                    placeholder="Patient number"
                    aria-label="Patient number"
                    onChange={(event) =>
                      setEnrollmentPatientNumber(event.target.value)
                    }
                  />

                  <button
                    type="submit"
                    className="secondary-button"
                    disabled={enrollmentLoading}
                  >
                    {enrollmentLoading
                      ? 'Requesting...'
                      : 'Request patient relationship'}
                  </button>
                </div>
              </form>

              {enrollmentError && (
                <div className="tenant-state tenant-state-error">
                  <p>{enrollmentError}</p>
                </div>
              )}

              {enrollmentSuccess && (
                <div className="tenant-state">
                  <p>{enrollmentSuccess}</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="tenant-card">
        <div className="tenant-card-header">
          <div>
            <h2>Patient records</h2>
            <p>
              {total} {total === 1 ? 'patient' : 'patients'}
            </p>
          </div>

          <div className="patient-filters">
            <input
              type="search"
              value={search}
              placeholder="Search name or patient number"
              aria-label="Search patients"
              onChange={(event) => handleSearch(event.target.value)}
            />

            <select
              value={status}
              aria-label="Patient status"
              onChange={(event) =>
                handleStatus(
                  event.target.value as PatientRecordStatus,
                )
              }
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
        </div>

        {loading && (
          <div className="tenant-state">
            <p>Loading patients...</p>
          </div>
        )}

        {!loading && error && (
          <div className="tenant-state tenant-state-error">
            <p>{error}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setReloadKey((current) => current + 1)}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && patients.length === 0 && (
          <div className="tenant-state">
            <h3>No patients found</h3>
            <p>
              No patient records match the current search and
              status filter.
            </p>
            {!search && status === 'ALL' && (
              <div className="patient-page-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={openRegistration}
                >
                  Register new patient
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setEnrollmentOpen(true);
                    setRegistrationOpen(false);
                    setEnrollmentError(null);
                    setEnrollmentSuccess(null);
                  }}
                >
                  Enroll existing patient
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && !error && patients.length > 0 && (
          <>
            <div className="patient-table-wrapper">
              <table className="patient-table">
                <thead>
                  <tr>
                    <th>Patient number</th>
                    <th>Name</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Registered</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {patients.map((patient) => (
                    <tr key={patient.id}>
                      <td>{patient.patientNumber}</td>
                      <td>
                        <strong>
                          {patient.patient.displayName}
                        </strong>
                      </td>
                      <td>
                        {patient.patient.location ?? '—'}
                      </td>
                      <td>
                        {statusLabel(patient.status)}
                      </td>
                      <td>
                        {formatDate(patient.registeredAt)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void openPatient(patient.id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="patient-pagination">
              <button
                type="button"
                className="secondary-button"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </button>

              <span>
                Page {page} of {totalPages}
              </span>

              <button
                type="button"
                className="secondary-button"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>

      {(detailLoading || detailError || selectedPatient) && (
        <div className="patient-detail-modal-backdrop">
          <section
            className="tenant-card patient-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Patient details"
          >
          {detailLoading && <p>Loading patient details...</p>}

          {!detailLoading && detailError && (
            <div className="tenant-state tenant-state-error">
              <p>{detailError}</p>
            </div>
          )}

          {!detailLoading && !detailError && selectedPatient && (
            <>
              <div className="tenant-card-header">
                <div>
                  <p className="eyebrow">Patient record</p>
                  <h2>{selectedPatient.patientProfile.user.displayName}</h2>
                  <p>
                    Patient number: {selectedPatient.patientNumber}
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSelectedPatient(null)}
                >
                  Close
                </button>
              </div>

              {selectedPatient.status === 'PENDING' &&
                selectedPatient.registrationVerificationPending && (
                  <div className="tenant-state" style={{ marginBottom: '1rem' }}>
                    <p className="eyebrow">Identity verification</p>
                    <h3>Verify patient identity</h3>
                    <p>
                      A verification code is sent to the patient&apos;s email.
                      Staff can send a fresh code and enter the patient-provided
                      code here. Verification activates this facility record.
                    </p>

                    <button
                      type="button"
                      className="secondary-button"
                      disabled={verificationSendLoading || verificationLoading}
                      onClick={() => void handleSendPatientVerificationCode()}
                    >
                      {verificationSendLoading
                        ? 'Sending code...'
                        : 'Send verification code'}
                    </button>

                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handlePatientVerification();
                      }}
                    >
                      <div className="patient-filters">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={verificationCode}
                          disabled={verificationLoading || !registrationChallengeId}
                          maxLength={6}
                          pattern="[0-9]{6}"
                          placeholder="6-digit verification code"
                          aria-label="Patient verification code"
                          onChange={(event) =>
                            setVerificationCode(
                              event.target.value.replace(/\D/g, '').slice(0, 6),
                            )
                          }
                        />

                        <button
                          type="submit"
                          className="secondary-button"
                          disabled={
                            verificationLoading ||
                            !registrationChallengeId ||
                            verificationCode.length !== 6
                          }
                        >
                          {verificationLoading
                            ? 'Verifying...'
                            : 'Verify identity'}
                        </button>
                      </div>
                    </form>

                    {verificationError && (
                      <div className="tenant-state tenant-state-error">
                        <p>{verificationError}</p>
                      </div>
                    )}

                    {verificationSuccess && (
                      <div className="tenant-state">
                        <p>{verificationSuccess}</p>
                      </div>
                    )}
                  </div>
                )}

              {selectedPatient.status === 'PENDING' &&
                selectedPatient.relationshipApprovalPending && (
                  <div className="tenant-state" style={{ marginBottom: '1rem' }}>
                    <p>
                      Relationship request already pending. Waiting for patient approval.
                    </p>
                  </div>
                )}

              <div className="patient-detail-grid">
                <div>
                  <span>First name</span>
                  <strong>
                    {selectedPatient.patientProfile.firstName}
                  </strong>
                </div>

                <div>
                  <span>Second name</span>
                  <strong>
                    {selectedPatient.patientProfile.secondName}
                  </strong>
                </div>

                <div>
                  <span>Location</span>
                  <strong>
                    {selectedPatient.patientProfile.location ?? '—'}
                  </strong>
                </div>

                <div>
                  <span>Status</span>
                  <strong>
                    {statusLabel(selectedPatient.status)}
                  </strong>
                </div>

                <div>
                  <span>Registered</span>
                  <strong>
                    {formatDate(selectedPatient.registeredAt)}
                  </strong>
                </div>

                <div>
                  <span>Record updated</span>
                  <strong>
                    {formatDate(selectedPatient.updatedAt)}
                  </strong>
                </div>
              </div>
            </>
          )}
          </section>
        </div>
      )}
    </main>
  );
}
