import { useEffect, useState } from 'react';
import {
  getPendingOwnershipParties,
  type PendingOwnershipParty,
} from '../../dashboard/api/tenant-ownership-review.api.js';

function label(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ManagementApprovalsPage({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const [parties, setParties] = useState<PendingOwnershipParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setParties(await getPendingOwnershipParties());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load pending approvals.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function review(
    party: PendingOwnershipParty,
    decision: 'VERIFIED' | 'REJECTED',
  ): Promise<void> {
    const reason =
      decision === 'REJECTED'
        ? window.prompt('Provide a rejection reason:')?.trim()
        : undefined;
    if (decision === 'REJECTED' && !reason) return;
    if (
      !window.confirm(
        `${decision === 'VERIFIED' ? 'Verify' : 'Reject'} ${party.fullName} for ${party.tenant.name}?`,
      )
    )
      return;
    setBusyId(party.id);
    setError(null);
    setNotice(null);
    try {
      const { reviewOwnershipParty } = await import(
        '../../dashboard/api/tenant-ownership-review.api.js'
      );
      await reviewOwnershipParty(party.id, decision, reason, '');
      setNotice(`${party.fullName} marked ${decision.toLowerCase()}.`);
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to save review decision.',
      );
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <main className="management-page">
        <p role="status">Loading pending approvals…</p>
      </main>
    );
  }

  return (
    <main className="management-page">
      <header className="management-page-header">
        <p className="management-page-eyebrow">APPROVAL CENTRE</p>
        <h1>Pending reviews</h1>
        <p className="management-page-description">
          Review ownership declarations and access requests that require platform authorization.
        </p>
      </header>

      {error && (
        <div className="management-alert is-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="management-alert is-success" role="status">
          {notice}
        </div>
      )}

      <div className="management-approval-list">
        {parties.length === 0 ? (
          <p className="management-empty">No pending approvals.</p>
        ) : (
          parties.map((party) => (
            <article key={party.id} className="management-approval-card">
              <header>
                <div>
                  <h2>{party.fullName}</h2>
                  <p>
                    {party.tenant.profile?.businessName || party.tenant.name} ·
                    {party.tenant.code}
                  </p>
                </div>
                <span>{label(party.partyType)} · {label(party.role)}</span>
              </header>
              <dl>
                <div>
                  <dt>Facility</dt>
                  <dd>
                    {party.tenant.name} ({label(party.tenant.type)})
                  </dd>
                </div>
                <div>
                  <dt>Registration number</dt>
                  <dd>
                    {party.registrationNumber ||
                      party.tenant.profile?.registrationNumber ||
                      'Not provided'}
                  </dd>
                </div>
                <div>
                  <dt>Country</dt>
                  <dd>{party.registrationCountry || 'Not provided'}</dd>
                </div>
                <div>
                  <dt>Submitted</dt>
                  <dd>
                    {party.submittedAt
                      ? new Date(party.submittedAt).toLocaleString()
                      : 'Not submitted'}
                  </dd>
                </div>
              </dl>
              <footer>
                <button
                  type="button"
                  className="management-approval-button reject"
                  disabled={busyId === party.id}
                  onClick={() => void review(party, 'REJECTED')}
                >
                  Reject with reason
                </button>
                <button
                  type="button"
                  className="management-approval-button verify"
                  disabled={busyId === party.id}
                  onClick={() => void review(party, 'VERIFIED')}
                >
                  Verify party
                </button>
              </footer>
            </article>
          ))
        )}
      </div>
    </main>
  );
}
