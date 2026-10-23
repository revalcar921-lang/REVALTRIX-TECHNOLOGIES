import { useEffect, useMemo, useState } from 'react';
import { getAuthSession } from '../../auth/api/auth-session.js';
import { Check, ClipboardCheck, FileCheck2, RefreshCw, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { requestStepUpChallengeId } from '../../../lib/step-up.js';
import {
  downloadDependentVerificationDocument,
  reviewDependentVerification,
} from '../../patient-family/api/family-verification-admin.api.js';
import {
  downloadOwnershipEvidence,
  getPendingOwnershipParties,
  reviewOwnershipParty,
  type PendingOwnershipParty,
} from '../api/tenant-ownership-review.api.js';
import {
  downloadTenantDocument,
  getSuperAdminQueues,
  reviewTenantActivation,
  reviewTenantDocument,
  type PendingTenantActivation,
  type PendingTenantDocument,
  type SuperAdminQueues,
} from '../api/super-admin.api.js';
import { getPendingDependentVerifications, type PendingDependentVerification } from '../../patient-family/api/family-verification-admin.api.js';
import './SuperAdminPage.css';
import './SuperAdminPage.css';

type QueueKey = 'overview' | 'documents' | 'ownership' | 'activations' | 'patients';

const queueNavigation: Array<{ key: QueueKey; label: string; icon: typeof ShieldCheck }> = [
  { key: 'overview', label: 'Overview', icon: ShieldCheck },
  { key: 'documents', label: 'Facility documents', icon: FileCheck2 },
  { key: 'ownership', label: 'Ownership verification', icon: UserRoundCheck },
  { key: 'activations', label: 'Activation requests', icon: Check },
  { key: 'patients', label: 'Patient verifications', icon: ClipboardCheck },
];

const emptyQueues: SuperAdminQueues = { documents: [], ownership: [], activations: [], dependents: [] };

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function personName(person: { firstName: string; secondName: string }): string {
  return `${person.firstName} ${person.secondName}`.trim();
}

export function SuperAdminPage({ onLogout }: { onLogout: () => void }) {
  const [activeQueue, setActiveQueue] = useState<QueueKey>('overview');
  const [queues, setQueues] = useState<SuperAdminQueues>(emptyQueues);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadQueues(): Promise<void> {
    setLoading(true);
    setError(null);

    if (!getAuthSession()) {
      setLoading(false);
      onLogout();
      return;
    }

    try {
      setQueues(await getSuperAdminQueues());
    } catch (loadError) {
      if (!getAuthSession()) {
        onLogout();
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load approval queues.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadQueues(); }, []);

  const queueCounts = useMemo<Record<QueueKey, number>>(() => ({
    overview: queues.documents.length + queues.ownership.length + queues.activations.length + queues.dependents.length,
    documents: queues.documents.length,
    ownership: queues.ownership.length,
    activations: queues.activations.length,
    patients: queues.dependents.length,
  }), [queues]);

  async function withStepUp(itemId: string, action: (challengeId: string) => Promise<unknown>, success: string): Promise<void> {
    setBusyId(itemId);
    setError(null);
    setNotice(null);
    try {
      const challengeId = await requestStepUpChallengeId();
      await action(challengeId);
      setNotice(success);
      await loadQueues();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to complete this review.');
    } finally {
      setBusyId(null);
    }
  }

  function requestReason(action: string, subject: string): string | undefined | null {
    if (action === 'approve') {
      return window.confirm(`Approve ${subject}?`) ? undefined : null;
    }
    const reason = window.prompt(`Reason for rejecting ${subject}:`)?.trim();
    if (!reason) {
      setError('Enter a clear reason before rejecting.');
      return null;
    }
    return reason;
  }

  function reviewDocument(document: PendingTenantDocument, decision: 'VERIFIED' | 'REJECTED'): void {
    const reason = requestReason(decision === 'VERIFIED' ? 'approve' : 'reject', document.title);
    if (reason === null) return;
    void withStepUp(document.id, (challenge) => reviewTenantDocument(document.id, decision, reason, challenge), `Facility document ${decision.toLowerCase()}.`);
  }

  function reviewOwnership(party: PendingOwnershipParty, decision: 'VERIFIED' | 'REJECTED'): void {
    const reason = requestReason(decision === 'VERIFIED' ? 'approve' : 'reject', `${party.fullName} at ${party.tenant.name}`);
    if (reason === null) return;
    void withStepUp(party.id, (challenge) => reviewOwnershipParty(party.id, decision, reason, challenge), `Ownership party ${decision.toLowerCase()}.`);
  }

  function reviewActivation(activation: PendingTenantActivation, decision: 'APPROVE' | 'REJECT'): void {
    const reason = requestReason(decision === 'APPROVE' ? 'approve' : 'reject', activation.tenant.name);
    if (reason === null) return;
    void withStepUp(activation.tenantId, (challenge) => reviewTenantActivation(activation.tenantId, decision, reason, challenge), `Activation request ${decision.toLowerCase()}.`);
  }

  function reviewDependent(registration: PendingDependentVerification, decision: 'APPROVE' | 'REJECT'): void {
    const subject = `${personName(registration.dependentPatientProfile)}'s verification`;
    const reason = requestReason(decision === 'APPROVE' ? 'approve' : 'reject', subject);
    if (reason === null) return;
    void withStepUp(registration.id, (challenge) => reviewDependentVerification(registration.id, {
      decision,
      ...(reason ? { rejectionReason: reason } : {}),
    }, challenge), `Patient verification ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`);
  }

  async function downloadTenantDoc(document: PendingTenantDocument): Promise<void> {
    setBusyId(document.id);
    setError(null);
    try {
      const challengeId = await requestStepUpChallengeId();
      await downloadTenantDocument(document.id, challengeId);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unable to open the facility document.');
    } finally {
      setBusyId(null);
    }
  }

  async function downloadOwnership(party: PendingOwnershipParty, evidenceId: string): Promise<void> {
    setBusyId(party.id);
    setError(null);
    try {
      const challengeId = await requestStepUpChallengeId();
      await downloadOwnershipEvidence(party.id, evidenceId, challengeId);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unable to open ownership evidence.');
    } finally {
      setBusyId(null);
    }
  }

  async function downloadDependent(registration: PendingDependentVerification, documentId: string): Promise<void> {
    setBusyId(registration.id);
    setError(null);
    try {
      const challengeId = await requestStepUpChallengeId();
      await downloadDependentVerificationDocument(registration.id, documentId, challengeId);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unable to open patient verification evidence.');
    } finally {
      setBusyId(null);
    }
  }

  function renderDocument(document: PendingTenantDocument) {
    return <article className="super-admin-approval-card" key={document.id}>
      <header><div><h2>{document.title}</h2><p>{document.tenant.profile?.businessName || document.tenant.name} · {document.tenant.code} · {titleCase(document.type)}</p></div><span className="super-admin-status">{titleCase(document.verificationStatus)}</span></header>
      <dl><div><dt>Registration</dt><dd>{document.tenant.profile?.registrationNumber || 'Not provided'}</dd></div><div><dt>Document number</dt><dd>{document.documentNumber || 'Not provided'}</dd></div><div><dt>Uploaded</dt><dd>{new Date(document.createdAt).toLocaleString()}</dd></div><div><dt>Expiry</dt><dd>{document.expiryDate ? new Date(document.expiryDate).toLocaleDateString() : 'No expiry date'}</dd></div></dl>
      <footer><button type="button" className="super-admin-button secondary" disabled={busyId === document.id} onClick={() => void downloadTenantDoc(document)}>Open securely</button><button type="button" className="super-admin-button reject" disabled={busyId === document.id} onClick={() => reviewDocument(document, 'REJECTED')}>Reject</button><button type="button" className="super-admin-button approve" disabled={busyId === document.id} onClick={() => reviewDocument(document, 'VERIFIED')}>Verify document</button></footer>
    </article>;
  }

  function renderOwnership(party: PendingOwnershipParty) {
    return <article className="super-admin-approval-card" key={party.id}>
      <header><div><h2>{party.fullName}</h2><p>{party.tenant.profile?.businessName || party.tenant.name} · {party.tenant.code}</p></div><span className="super-admin-status">{titleCase(party.partyType)} · {titleCase(party.role)}</span></header>
      <dl><div><dt>Registration</dt><dd>{party.registrationNumber || party.tenant.profile?.registrationNumber || 'Not provided'}</dd></div><div><dt>Country</dt><dd>{party.registrationCountry || 'Not provided'}</dd></div><div><dt>ID type</dt><dd>{party.identityDocumentType ? titleCase(party.identityDocumentType) : 'Not applicable'}</dd></div><div><dt>Submitted</dt><dd>{party.submittedAt ? new Date(party.submittedAt).toLocaleString() : 'Not provided'}</dd></div></dl>
      <ul className="super-admin-evidence-list">{party.evidence.map((evidence) => <li key={evidence.id}><span>{titleCase(evidence.evidenceType)} · {evidence.fileName}</span><button type="button" className="super-admin-button secondary" disabled={busyId === party.id} onClick={() => void downloadOwnership(party, evidence.id)}>Open securely</button></li>)}</ul>
      <footer><button type="button" className="super-admin-button reject" disabled={busyId === party.id} onClick={() => reviewOwnership(party, 'REJECTED')}>Reject</button><button type="button" className="super-admin-button approve" disabled={busyId === party.id} onClick={() => reviewOwnership(party, 'VERIFIED')}>Verify party</button></footer>
    </article>;
  }

  function renderActivation(activation: PendingTenantActivation) {
    return <article className="super-admin-approval-card" key={activation.tenantId}>
      <header><div><h2>{activation.tenant.profile?.businessName || activation.tenant.name}</h2><p>{activation.tenant.name} · {activation.tenant.code} · {titleCase(activation.tenant.type)}</p></div><span className="super-admin-status">{activation.readinessPercent}% ready</span></header>
      <dl><div><dt>Legal name</dt><dd>{activation.tenant.legalName || 'Not provided'}</dd></div><div><dt>Registration</dt><dd>{activation.tenant.profile?.registrationNumber || 'Not provided'}</dd></div><div><dt>Contact email</dt><dd>{activation.tenant.profile?.contactEmail || 'Not provided'}</dd></div><div><dt>Requested</dt><dd>{activation.activationRequestedAt ? new Date(activation.activationRequestedAt).toLocaleString() : 'Not provided'}</dd></div></dl>
      <footer><button type="button" className="super-admin-button reject" disabled={busyId === activation.tenantId} onClick={() => reviewActivation(activation, 'REJECT')}>Request changes</button><button type="button" className="super-admin-button approve" disabled={busyId === activation.tenantId} onClick={() => reviewActivation(activation, 'APPROVE')}>Approve activation</button></footer>
    </article>;
  }

  function renderDependent(registration: PendingDependentVerification) {
    return <article className="super-admin-approval-card" key={registration.id}>
      <header><div><h2>{personName(registration.dependentPatientProfile)}</h2><p>Guardian: {personName(registration.registeredByPatientProfile)}</p></div><span className="super-admin-status">Dependent verification</span></header>
      <dl><div><dt>Patient ID</dt><dd>{registration.dependentPatientProfile.platformPatientId}</dd></div><div><dt>Date of birth</dt><dd>{registration.dependentPatientProfile.dateOfBirth ? new Date(registration.dependentPatientProfile.dateOfBirth).toLocaleDateString() : 'Not provided'}</dd></div><div><dt>Submitted</dt><dd>{new Date(registration.createdAt).toLocaleString()}</dd></div><div><dt>Registration</dt><dd>{registration.id}</dd></div></dl>
      <ul className="super-admin-evidence-list">{registration.verificationDocuments.map((document) => <li key={document.id}><span>{titleCase(document.documentType)} · {document.fileName}</span><button type="button" className="super-admin-button secondary" disabled={busyId === registration.id} onClick={() => void downloadDependent(registration, document.id)}>Open securely</button></li>)}</ul>
      <footer><button type="button" className="super-admin-button reject" disabled={busyId === registration.id} onClick={() => reviewDependent(registration, 'REJECT')}>Reject</button><button type="button" className="super-admin-button approve" disabled={busyId === registration.id} onClick={() => reviewDependent(registration, 'APPROVE')}>Approve patient verification</button></footer>
    </article>;
  }

  const activeCount = activeQueue === 'overview' ? queueCounts.overview : queueCounts[activeQueue];
  const records = activeQueue === 'documents' ? queues.documents : activeQueue === 'ownership' ? queues.ownership : activeQueue === 'activations' ? queues.activations : queues.dependents;

  return (
    <main className="super-admin-shell">
      <aside className="super-admin-sidebar">
        <div className="super-admin-brand"><span className="super-admin-brand-mark">R</span><span><strong>REVALTRIX</strong><small>Platform operations</small></span></div>
        <nav aria-label="Super admin approval queues">{queueNavigation.map(({ key, label, icon: Icon }) => <button type="button" key={key} className={activeQueue === key ? 'active' : ''} onClick={() => setActiveQueue(key)}><Icon size={17} /><span>{label}</span>{key !== 'overview' ? <small>{queueCounts[key]}</small> : null}</button>)}</nav>
        <button type="button" className="super-admin-logout" onClick={onLogout}>Sign out</button>
      </aside>
      <section className="super-admin-content">
        <header className="super-admin-header"><div><p>PLATFORM REVIEW</p><h1>{queueNavigation.find((item) => item.key === activeQueue)?.label}</h1><span>{activeCount} pending {activeCount === 1 ? 'item' : 'items'}</span></div><button type="button" className="super-admin-button secondary" disabled={loading} onClick={() => void loadQueues()}><RefreshCw size={16} /> Refresh</button></header>
        {error ? <p className="super-admin-alert" role="alert">{error}</p> : null}
        {notice ? <p className="super-admin-notice" role="status">{notice}</p> : null}
        {loading ? <p role="status">Loading approval queues…</p> : activeQueue === 'overview' ? <div className="super-admin-overview-grid">{queueNavigation.filter((queue) => queue.key !== 'overview').map(({ key, label, icon: Icon }) => <button type="button" key={key} onClick={() => setActiveQueue(key)}><Icon size={20} /><span><strong>{label}</strong><small>{queueCounts[key]} pending</small></span></button>)}</div> : <div className="super-admin-approval-list">
          {activeCount === 0 ? <p className="super-admin-empty">No pending {queueNavigation.find((item) => item.key === activeQueue)?.label.toLowerCase()}.</p> : null}
          {activeQueue === 'documents' ? queues.documents.map(renderDocument) : null}
          {activeQueue === 'ownership' ? queues.ownership.map(renderOwnership) : null}
          {activeQueue === 'activations' ? queues.activations.map(renderActivation) : null}
          {activeQueue === 'patients' ? queues.dependents.map(renderDependent) : null}
        </div>}
      </section>
    </main>
  );
}