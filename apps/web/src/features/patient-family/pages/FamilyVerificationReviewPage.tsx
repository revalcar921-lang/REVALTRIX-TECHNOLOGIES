import { FormEvent, useEffect, useState } from 'react';
import {
  downloadDependentVerificationDocument,
  flagDependentVerification,
  getPendingDependentVerifications,
  reviewDependentVerification,
  type PendingDependentVerification,
} from '../api/family-verification-admin.api.js';

function personName(person: { firstName: string; secondName: string }) {
  return `${person.firstName} ${person.secondName}`.trim();
}

export function FamilyVerificationReviewPage({
  onNavigate,
  onLogout,
}: {
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  const [registrations, setRegistrations] = useState<
    PendingDependentVerification[]
  >([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadRegistrations(query = search) {
    setLoading(true);
    setError(null);
    try {
      const response = await getPendingDependentVerifications(query);
      setRegistrations(response.data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load pending dependent registrations.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRegistrations('');
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadRegistrations(search.trim());
  }

  async function handleDownload(
    registration: PendingDependentVerification,
    documentId: string,
  ) {
    setBusyId(registration.id);
    setError(null);
    try {
      await downloadDependentVerificationDocument(
        registration.id,
        documentId,
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : 'Unable to open the verification document.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleReview(
    registration: PendingDependentVerification,
    decision: 'APPROVE' | 'REJECT',
  ) {
    const rejectionReason =
      decision === 'REJECT'
        ? window.prompt('Enter a clear reason for rejection:')?.trim()
        : undefined;
    if (decision === 'REJECT' && !rejectionReason) {
      setError('A rejection reason is required.');
      return;
    }
    if (
      !window.confirm(
        `${decision === 'APPROVE' ? 'Approve' : 'Reject'} verification for ${personName(registration.dependentPatientProfile)}?`,
      )
    ) {
      return;
    }
    setBusyId(registration.id);
    setError(null);
    setMessage(null);
    try {
      await reviewDependentVerification(
        registration.id,
        {
          decision,
          ...(rejectionReason ? { rejectionReason } : {}),
        },
      );
      setMessage(
        decision === 'APPROVE'
          ? 'Dependent verification approved.'
          : 'Verification rejected. The guardian can upload replacement documents.',
      );
      await loadRegistrations();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : 'Unable to review this registration.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleFlag(registration: PendingDependentVerification) {
    const reason = window.prompt(
      'Describe the suspicious or duplicate-registration concern:',
    )?.trim();
    if (!reason) return;
    setBusyId(registration.id);
    setError(null);
    try {
      await flagDependentVerification(registration.id, reason);
      setMessage('Registration flagged for additional review.');
      await loadRegistrations();
    } catch (flagError) {
      setError(
        flagError instanceof Error
          ? flagError.message
          : 'Unable to flag this registration.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="patient-dashboard-main">
      <header className="patient-dashboard-header">
        <div>
          <span className="patient-eyebrow">AUTHORIZED REVIEWERS</span>
          <h1>Dependent verification</h1>
          <p>
            Review privately stored identity evidence before enabling verified
            guardian authority. Opening documents and decisions require a
            one-time security check.
          </p>
        </div>
        <button
          type="button"
          className="patient-dashboard-button secondary"
          onClick={onLogout}
        >
          Sign out
        </button>
      </header>

      {error ? <div className="patient-alert error" role="alert">{error}</div> : null}
      {message ? <div className="patient-alert success" role="status">{message}</div> : null}

      <section className="patient-profile-section">
        <form className="patient-family-request-form" onSubmit={handleSearch}>
          <label>
            <span>Search guardian, child, phone, email or registration ID</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={320}
              placeholder="Enter a name, contact or registration ID"
            />
          </label>
          <button className="patient-dashboard-button" type="submit">
            Search
          </button>
        </form>
      </section>

      <section className="patient-profile-section">
        <div className="patient-section-heading">
          <div>
            <span className="patient-eyebrow">PENDING VERIFICATION</span>
            <h2>Registrations awaiting review</h2>
          </div>
          <span className="patient-section-count">{registrations.length}</span>
        </div>

        {loading ? (
          <div className="patient-empty-state">Loading pending registrations…</div>
        ) : registrations.length === 0 ? (
          <div className="patient-empty-state">
            <strong>No pending verification documents.</strong>
            <p>New dependent registrations will appear here after required documents are uploaded.</p>
          </div>
        ) : (
          <div className="patient-family-list">
            {registrations.map((registration) => (
              <article className="patient-family-card" key={registration.id}>
                <div>
                  <strong>{personName(registration.dependentPatientProfile)}</strong>
                  <span>
                    Guardian: {personName(registration.registeredByPatientProfile)}
                  </span>
                  <small>
                    Child ID {registration.dependentPatientProfile.platformPatientId}
                    {' · '}DOB{' '}
                    {registration.dependentPatientProfile.dateOfBirth
                      ? new Date(
                          registration.dependentPatientProfile.dateOfBirth,
                        ).toLocaleDateString()
                      : 'Not provided'}
                  </small>
                  <small>Registration ID: {registration.id}</small>
                  <small>
                    Submitted {new Date(registration.createdAt).toLocaleString()}
                  </small>
                  {registration.verificationNotes ? (
                    <p>Reviewer note: {registration.verificationNotes}</p>
                  ) : null}
                  <ul>
                    {registration.verificationDocuments.map((file) => (
                      <li key={file.id}>
                        {file.documentType.replaceAll('_', ' ')} · {file.fileName}
                        {' · '}
                        {(Number(file.fileSize) / (1024 * 1024)).toFixed(2)} MB
                        <button
                          type="button"
                          className="patient-dashboard-button secondary"
                          disabled={busyId === registration.id}
                          onClick={() =>
                            void handleDownload(registration, file.id)
                          }
                        >
                          Open securely
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="patient-family-actions">
                  <button
                    type="button"
                    className="patient-dashboard-button"
                    disabled={busyId === registration.id}
                    onClick={() => void handleReview(registration, 'APPROVE')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="patient-dashboard-button danger"
                    disabled={busyId === registration.id}
                    onClick={() => void handleReview(registration, 'REJECT')}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="patient-dashboard-button secondary"
                    disabled={busyId === registration.id}
                    onClick={() => void handleFlag(registration)}
                  >
                    Flag concern
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <button
        type="button"
        className="patient-dashboard-button secondary"
        onClick={() => onNavigate('/dashboard')}
      >
        Back to dashboard
      </button>
    </main>
  );
}
