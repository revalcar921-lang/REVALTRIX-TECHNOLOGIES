import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { downloadOwnershipEvidence, getPendingOwnershipParties, reviewOwnershipParty, type PendingOwnershipParty } from '../api/tenant-ownership-review.api.js';

function label(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function TenantOwnershipReviewPage({ onLogout }: { onLogout: () => void }) {
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
      setError(requestError instanceof Error ? requestError.message : 'Unable to load ownership reviews.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function download(party: PendingOwnershipParty, evidenceId: string): Promise<void> {
    setBusyId(party.id);
    setError(null);
    try {
      await downloadOwnershipEvidence(party.id, evidenceId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to access evidence.');
    } finally {
      setBusyId(null);
    }
  }

  async function review(party: PendingOwnershipParty, decision: 'VERIFIED' | 'REJECTED'): Promise<void> {
    const reason = decision === 'REJECTED' ? window.prompt('Provide a rejection reason:')?.trim() : undefined;
    if (decision === 'REJECTED' && !reason) return;
    if (!window.confirm(`${decision === 'VERIFIED' ? 'Verify' : 'Reject'} ${party.fullName} for ${party.tenant.name}?`)) return;
    setBusyId(party.id);
    setError(null);
    setNotice(null);
    try {
      await reviewOwnershipParty(party.id, decision, reason);
      setNotice(`${party.fullName} marked ${decision.toLowerCase()}.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save review decision.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="patient-dashboard-main ownership-review-page">
      <header className="patient-dashboard-header">
        <div><span className="patient-eyebrow">AUTHORIZED REVIEWERS</span><h1>Tenant ownership verification</h1><p>Review entity registration and each declared owner, director, beneficial owner, or authorized official. File integrity checks are not identity approval.</p></div>
        <div className="ownership-review-actions"><button type="button" className="patient-dashboard-button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} /> Refresh</button><button type="button" className="patient-dashboard-button secondary" onClick={onLogout}>Sign out</button></div>
      </header>
      {error ? <p className="tenant-setup-config-message is-error" role="alert">{error}</p> : null}
      {notice ? <p className="tenant-setup-config-message" role="status">{notice}</p> : null}
      {loading ? <p role="status">Loading pending reviews…</p> : parties.length ? <div className="ownership-review-list">
        {parties.map((party) => <article className="ownership-review-party" key={party.id}>
          <header><div><h2>{party.fullName}</h2><p>{party.tenant.profile?.businessName || party.tenant.name} · {party.tenant.code}</p></div><span>{label(party.partyType)} · {label(party.role)}</span></header>
          <dl><div><dt>Facility</dt><dd>{party.tenant.name} ({label(party.tenant.type)})</dd></div><div><dt>Registration number</dt><dd>{party.registrationNumber || party.tenant.profile?.registrationNumber || 'Not provided'}</dd></div><div><dt>Country</dt><dd>{party.registrationCountry || 'Not provided'}</dd></div><div><dt>Identity document type</dt><dd>{party.identityDocumentType ? label(party.identityDocumentType) : 'Not applicable'}</dd></div><div><dt>Submitted</dt><dd>{party.submittedAt ? new Date(party.submittedAt).toLocaleString() : 'Not submitted'}</dd></div></dl>
          <h3>Evidence</h3>
          <div className="ownership-review-evidence">{party.evidence.map((evidence) => <article key={evidence.id}><span><strong>{label(evidence.evidenceType)}</strong><small>{evidence.fileName} · {(evidence.sizeBytes / (1024 * 1024)).toFixed(2)} MB</small></span><button type="button" className="patient-dashboard-button secondary" disabled={busyId === party.id} onClick={() => void download(party, evidence.id)}><Download size={15} /> Open privately</button></article>)}</div>
          <footer><button type="button" className="patient-dashboard-button secondary" disabled={busyId === party.id} onClick={() => void review(party, 'REJECTED')}>Reject with reason</button><button type="button" className="patient-dashboard-button primary" disabled={busyId === party.id} onClick={() => void review(party, 'VERIFIED')}>Verify party</button></footer>
        </article>)}
      </div> : <p className="patient-dashboard-empty">No ownership reviews are pending.</p>}
    </main>
  );
}