import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  getPendingOwnershipParties,
  getPendingActivations,
  getPendingTenantDocuments,
  reviewOwnershipParty,
  reviewActivation,
  reviewTenantDocument,
  downloadOwnershipEvidence,
  downloadTenantDocument,
  type PendingOwnershipParty,
  type PendingActivation,
  type PendingTenantDocument,
} from '../../dashboard/api/tenant-ownership-review.api.js';
import {
  getPendingDependentVerifications,
  reviewDependentVerification,
  downloadDependentVerificationDocument,
  type PendingDependentVerification,
} from '../../patient-family/api/family-verification-admin.api.js';

function label(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const TABS: Array<{ key: string; label: string; countKey: string }> = [
  { key: 'ownership', label: 'Ownership Declarations', countKey: 'ownershipParties' },
  { key: 'activations', label: 'Tenant Activations', countKey: 'activations' },
  { key: 'documents', label: 'Compliance Documents', countKey: 'documents' },
  { key: 'dependents', label: 'Dependent Verifications', countKey: 'dependents' },
];

export function ManagementApprovalsPage({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const [activeTab, setActiveTab] = useState<string>('ownership');
  const [ownershipParties, setOwnershipParties] = useState<PendingOwnershipParty[]>([]);
  const [activations, setActivations] = useState<PendingActivation[]>([]);
  const [documents, setDocuments] = useState<PendingTenantDocument[]>([]);
  const [dependents, setDependents] = useState<PendingDependentVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        getPendingOwnershipParties().then((data) => setOwnershipParties(data)),
        getPendingActivations().then((data) => setActivations(data)),
        getPendingTenantDocuments().then((data) => setDocuments(data)),
        getPendingDependentVerifications().then(({ data }) => setDependents(data)),
      ]);
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

  async function reviewOwnership(
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
      await reviewOwnershipParty(party.id, decision, reason);
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

  async function reviewActivationRequest(
    activation: PendingActivation,
    decision: 'APPROVE' | 'REJECT',
  ): Promise<void> {
    const reason =
      decision === 'REJECT'
        ? window.prompt('Provide a rejection reason:')?.trim()
        : undefined;
    if (decision === 'REJECT' && !reason) return;
    if (
      !window.confirm(
        `${decision === 'APPROVE' ? 'Approve' : 'Reject'} activation for ${activation.tenant.profile?.businessName || activation.tenant.name}?`,
      )
    )
      return;
    setBusyId(activation.id);
    setError(null);
    setNotice(null);
    try {
      await reviewActivation(activation.id, decision, reason);
      setNotice(
        `Activation for ${activation.tenant.profile?.businessName || activation.tenant.name} ${decision.toLowerCase()}.`,
      );
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to save activation decision.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reviewDocument(
    doc: PendingTenantDocument,
    decision: 'VERIFIED' | 'REJECTED',
  ): Promise<void> {
    const reason =
      decision === 'REJECTED'
        ? window.prompt('Provide a rejection reason:')?.trim()
        : undefined;
    if (decision === 'REJECTED' && !reason) return;
    if (
      !window.confirm(
        `${decision === 'VERIFIED' ? 'Verify' : 'Reject'} document "${doc.title}" for ${doc.tenant.name}?`,
      )
    )
      return;
    setBusyId(doc.id);
    setError(null);
    setNotice(null);
    try {
      await reviewTenantDocument(doc.id, decision, reason);
      setNotice(`Document "${doc.title}" marked ${decision.toLowerCase()}.`);
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to save document decision.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reviewDependent(
    dependent: PendingDependentVerification,
    decision: 'APPROVE' | 'REJECT',
  ): Promise<void> {
    const reason =
      decision === 'REJECT'
        ? window.prompt('Provide a rejection reason:')?.trim()
        : undefined;
    if (decision === 'REJECT' && !reason) return;
    if (
      !window.confirm(
        `${decision === 'APPROVE' ? 'Approve' : 'Reject'} dependent verification for ${dependent.dependentPatientProfile.firstName} ${dependent.dependentPatientProfile.secondName}?`,
      )
    )
      return;
    setBusyId(dependent.id);
    setError(null);
    setNotice(null);
    try {
      await reviewDependentVerification(dependent.id, {
        decision,
        ...(reason ? { rejectionReason: reason } : {}),
      });
      setNotice(
        `Dependent verification for ${dependent.dependentPatientProfile.firstName} ${dependent.dependentPatientProfile.secondName} ${decision.toLowerCase()}.`,
      );
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to save dependent decision.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function downloadEvidence(
    party: PendingOwnershipParty,
    evidenceId: string,
  ): Promise<void> {
    setBusyId(party.id);
    try {
      await downloadOwnershipEvidence(party.id, evidenceId);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to access evidence.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function downloadComplianceDocument(doc: PendingTenantDocument): Promise<void> {
    setBusyId(doc.id);
    try {
      await downloadTenantDocument(doc.id);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to download document.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function downloadDependentDocument(
    dependent: PendingDependentVerification,
    documentId: string,
  ): Promise<void> {
    setBusyId(dependent.id);
    try {
      await downloadDependentVerificationDocument(dependent.id, documentId);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to download document.',
      );
    } finally {
      setBusyId(null);
    }
  }

  const currentTab = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  const getItems = () => {
    switch (activeTab) {
      case 'ownership':
        return ownershipParties;
      case 'activations':
        return activations;
      case 'documents':
        return documents;
      case 'dependents':
        return dependents;
      default:
        return [];
    }
  };

  const items = getItems();
  const totalPending =
    ownershipParties.length +
    activations.length +
    documents.length +
    dependents.length;

  if (loading) {
    return (
      <main className="management-approvals-page">
        <div className="approvals-loading">
          <p role="status">Loading pending approvals…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="management-approvals-page">
      {notice ? (
        <div className="approvals-notice approvals-notice-success" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="approvals-notice approvals-notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <header className="approvals-header">
        <div className="approvals-header-content">
          <p className="approvals-eyebrow">APPROVAL CENTRE</p>
          <h1>Pending reviews</h1>
          <p className="approvals-description">
            Review ownership declarations, tenant activations, compliance documents,
            and dependent verifications that require platform authorization.
          </p>
        </div>
        <div className="approvals-stat">
          <span className="approvals-stat-number">{totalPending}</span>
          <span className="approvals-stat-label">pending item{totalPending === 1 ? '' : 's'}</span>
        </div>
      </header>

      <nav className="approvals-tabs">
        {TABS.map((tab) => {
          const itemsForTab =
            activeTab === 'ownership'
              ? ownershipParties.length
              : activeTab === 'activations'
                ? activations.length
                : activeTab === 'documents'
                  ? documents.length
                  : dependents.length;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              className={`approvals-tab${isActive ? ' approvals-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={isActive}
            >
              <span className="approvals-tab-label">{tab.label}</span>
              {itemsForTab > 0 ? (
                <span className="approvals-tab-badge">{itemsForTab}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <div className="approvals-empty">
          <p>No pending {currentTab.label.toLowerCase()}.</p>
        </div>
      ) : (
        <div className="approvals-list">
          {items.map((item) => {
            if (activeTab === 'ownership') {
              const party = item as PendingOwnershipParty;
              return (
                <article
                  key={party.id}
                  className="approvals-card approvals-card-ownership"
                >
                  <header className="approvals-card-header">
                    <div className="approvals-card-identity">
                      <h2 className="approvals-card-title">{party.fullName}</h2>
                      <span className="approvals-status-badge approvals-status-pending">
                        Pending
                      </span>
                    </div>
                    <div className="approvals-card-meta">
                      <p className="approvals-card-org">
                        {party.tenant.name} · {party.tenant.code}
                      </p>
                      <p className="approvals-card-role">
                        {label(party.partyType)} · {label(party.role)}
                      </p>
                    </div>
                  </header>

                  <dl className="approvals-card-details">
                    {party.registrationNumber && (
                      <div className="approvals-detail-row">
                        <dt>Registration number</dt>
                        <dd>{party.registrationNumber}</dd>
                      </div>
                    )}
                    {party.registrationCountry && (
                      <div className="approvals-detail-row">
                        <dt>Country</dt>
                        <dd>{party.registrationCountry}</dd>
                      </div>
                    )}
                    {party.submittedAt && (
                      <div className="approvals-detail-row">
                        <dt>Submitted</dt>
                        <dd>{new Date(party.submittedAt).toLocaleString()}</dd>
                      </div>
                    )}
                  </dl>

                  {party.evidence.length > 0 && (
                    <section className="approvals-card-evidence">
                      <h3 className="approvals-card-section-title">Evidence</h3>
                      <div className="approvals-evidence-list">
                        {party.evidence.map((evidence) => (
                          <div
                            key={evidence.id}
                            className="approvals-evidence-item"
                          >
                            <span className="approvals-evidence-label">
                              {label(evidence.evidenceType)} · {evidence.fileName} · {(evidence.sizeBytes / 1024).toFixed(1)} KB
                            </span>
                            <button
                              type="button"
                              className="approvals-download-button"
                              disabled={busyId === party.id}
                              onClick={() => void downloadEvidence(party, evidence.id)}
                            >
                              <Download size={13} /> Open privately
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <footer className="approvals-card-actions">
                    <button
                      type="button"
                      className="approvals-action-button approvals-action-reject"
                      disabled={busyId === party.id}
                      onClick={() => void reviewOwnership(party, 'REJECTED')}
                    >
                      Reject with reason
                    </button>
                    <button
                      type="button"
                      className="approvals-action-button approvals-action-verify"
                      disabled={busyId === party.id}
                      onClick={() => void reviewOwnership(party, 'VERIFIED')}
                    >
                      Verify party
                    </button>
                  </footer>
                </article>
              );
            }

            if (activeTab === 'activations') {
              const activation = item as PendingActivation;
              return (
                <article
                  key={activation.id}
                  className="approvals-card approvals-card-activation"
                >
                  <header className="approvals-card-header">
                    <div className="approvals-card-identity">
                      <h2 className="approvals-card-title">
                        {activation.tenant.profile?.businessName || activation.tenant.name}
                      </h2>
                      <span className="approvals-status-badge approvals-status-pending">
                        Pending
                      </span>
                    </div>
                    <div className="approvals-card-meta">
                      <p className="approvals-card-org">
                        {activation.tenant.name} · {activation.tenant.code}
                      </p>
                      <p className="approvals-card-role">
                        {activation.readinessPercent !== null
                          ? `${activation.readinessPercent}% readiness`
                          : 'Readiness not assessed'}
                      </p>
                    </div>
                  </header>

                  {activation.activationRequestedAt && (
                    <dl className="approvals-card-details">
                      <div className="approvals-detail-row">
                        <dt>Activation requested</dt>
                        <dd>
                          {new Date(activation.activationRequestedAt).toLocaleString()}
                        </dd>
                      </div>
                    </dl>
                  )}

                  <footer className="approvals-card-actions">
                    <button
                      type="button"
                      className="approvals-action-button approvals-action-reject"
                      disabled={busyId === activation.id}
                      onClick={() => void reviewActivationRequest(activation, 'REJECT')}
                    >
                      Reject with reason
                    </button>
                    <button
                      type="button"
                      className="approvals-action-button approvals-action-verify"
                      disabled={busyId === activation.id}
                      onClick={() => void reviewActivationRequest(activation, 'APPROVE')}
                    >
                      Approve activation
                    </button>
                  </footer>
                </article>
              );
            }

            if (activeTab === 'documents') {
              const doc = item as PendingTenantDocument;
              return (
                <article key={doc.id} className="approvals-card approvals-card-document">
                  <header className="approvals-card-header">
                    <div className="approvals-card-identity">
                      <h2 className="approvals-card-title">{doc.title}</h2>
                      <span className="approvals-status-badge approvals-status-pending">
                        Pending
                      </span>
                    </div>
                    <div className="approvals-card-meta">
                      <p className="approvals-card-org">{doc.tenant.name}</p>
                      <p className="approvals-card-role">
                        {label(doc.type)} · {label(doc.verificationStatus)}
                      </p>
                    </div>
                  </header>

                  <dl className="approvals-card-details">
                    {doc.documentNumber && (
                      <div className="approvals-detail-row">
                        <dt>Document number</dt>
                        <dd>{doc.documentNumber}</dd>
                      </div>
                    )}
                    {doc.issuingAuthority && (
                      <div className="approvals-detail-row">
                        <dt>Issuing authority</dt>
                        <dd>{doc.issuingAuthority}</dd>
                      </div>
                    )}
                    {doc.issueDate && (
                      <div className="approvals-detail-row">
                        <dt>Issue date</dt>
                        <dd>{new Date(doc.issueDate).toLocaleString()}</dd>
                      </div>
                    )}
                    {doc.expiryDate && (
                      <div className="approvals-detail-row">
                        <dt>Expiry date</dt>
                        <dd>{new Date(doc.expiryDate).toLocaleString()}</dd>
                      </div>
                    )}
                    <div className="approvals-detail-row">
                      <dt>Submitted</dt>
                      <dd>{new Date(doc.createdAt).toLocaleString()}</dd>
                    </div>
                  </dl>

                  <section className="approvals-card-file">
                    <span className="approvals-file-info">
                      {doc.fileName} · {doc.fileSizeBytes ? (doc.fileSizeBytes / 1024).toFixed(1) + ' KB' : ''}
                    </span>
                    <button
                      type="button"
                      className="approvals-download-button"
                      disabled={busyId === doc.id}
                      onClick={() => void downloadComplianceDocument(doc)}
                    >
                      <Download size={13} /> Open privately
                    </button>
                  </section>

                  <footer className="approvals-card-actions">
                    <button
                      type="button"
                      className="approvals-action-button approvals-action-reject"
                      disabled={busyId === doc.id}
                      onClick={() => void reviewDocument(doc, 'REJECTED')}
                    >
                      Reject with reason
                    </button>
                    <button
                      type="button"
                      className="approvals-action-button approvals-action-verify"
                      disabled={busyId === doc.id}
                      onClick={() => void reviewDocument(doc, 'VERIFIED')}
                    >
                      Verify document
                    </button>
                  </footer>
                </article>
              );
            }

            if (activeTab === 'dependents') {
              const dependent = item as PendingDependentVerification;
              return (
                <article
                  key={dependent.id}
                  className="approvals-card approvals-card-dependent"
                >
                  <header className="approvals-card-header">
                    <div className="approvals-card-identity">
                      <h2 className="approvals-card-title">
                        {dependent.dependentPatientProfile.firstName} {dependent.dependentPatientProfile.secondName}
                      </h2>
                      <span className="approvals-status-badge approvals-status-pending">
                        Pending
                      </span>
                    </div>
                    <div className="approvals-card-meta">
                      <p className="approvals-card-org">
                        Registered by:{' '}
                        {dependent.registeredByPatientProfile.firstName} {dependent.registeredByPatientProfile.secondName}
                      </p>
                      <p className="approvals-card-role">
                        {dependent.verificationNotes || 'Dependent verification'}
                      </p>
                    </div>
                  </header>

                  <dl className="approvals-card-details">
                    {dependent.dependentPatientProfile.dateOfBirth && (
                      <div className="approvals-detail-row">
                        <dt>Date of birth</dt>
                        <dd>{dependent.dependentPatientProfile.dateOfBirth}</dd>
                      </div>
                    )}
                    <div className="approvals-detail-row">
                      <dt>Submitted</dt>
                      <dd>
                        {dependent.createdAt ? new Date(dependent.createdAt).toLocaleString() : 'Not submitted'}
                      </dd>
                    </div>
                  </dl>

                  {dependent.verificationDocuments.length > 0 && (
                    <section className="approvals-card-documents">
                      <h3 className="approvals-card-section-title">Documents</h3>
                      <div className="approvals-evidence-list">
                        {dependent.verificationDocuments.map((doc) => (
                          <div key={doc.id} className="approvals-evidence-item">
                            <span className="approvals-evidence-label">
                              {doc.documentType} · {doc.fileName} · {doc.fileSize}
                            </span>
                            <button
                              type="button"
                              className="approvals-download-button"
                              disabled={busyId === dependent.id}
                              onClick={() => void downloadDependentDocument(dependent, doc.id)}
                            >
                              <Download size={13} /> Open privately
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <footer className="approvals-card-actions">
                    <button
                      type="button"
                      className="approvals-action-button approvals-action-reject"
                      disabled={busyId === dependent.id}
                      onClick={() => void reviewDependent(dependent, 'REJECT')}
                    >
                      Reject with reason
                    </button>
                    <button
                      type="button"
                      className="approvals-action-button approvals-action-verify"
                      disabled={busyId === dependent.id}
                      onClick={() => void reviewDependent(dependent, 'APPROVE')}
                    >
                      Approve dependent
                    </button>
                  </footer>
                </article>
              );
            }

            return null;
          })}
        </div>
      )}
    </main>
  );
}
