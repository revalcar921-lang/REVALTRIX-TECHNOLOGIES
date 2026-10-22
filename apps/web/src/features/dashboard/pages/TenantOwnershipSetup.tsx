import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Send, Trash2, Upload } from 'lucide-react';
import './TenantOwnershipSetup.css';
import {
  createOwnershipParty,
  getMyOwnershipVerification,
  removeOwnershipEvidence,
  removeOwnershipParty,
  submitOwnershipDeclaration,
  uploadOwnershipEvidence,
  type OwnershipEvidenceType,
  type OwnershipParty,
  type OwnershipPartyInput,
  type OwnershipPartyRole,
  type OwnershipPartyType,
  type TenantOwnershipResponse,
} from '../api/tenant-ownership.api.js';

const initialParty: OwnershipPartyInput = {
  partyType: 'INDIVIDUAL',
  role: 'OWNER',
  fullName: '',
  registrationNumber: '',
  registrationCountry: '',
  identityDocumentType: 'NATIONAL_ID',
};

function roleOptions(type: OwnershipPartyType): OwnershipPartyRole[] {
  if (type !== 'INDIVIDUAL') return ['OWNER'];
  return ['OWNER', 'DIRECTOR', 'BENEFICIAL_OWNER', 'AUTHORIZED_OFFICIAL'];
}

function evidenceOptions(party: OwnershipParty): OwnershipEvidenceType[] {
  if (party.partyType === 'INDIVIDUAL') return ['IDENTITY_DOCUMENT', 'SELFIE'];
  if (party.partyType === 'LEGAL_ENTITY') return ['BUSINESS_REGISTRATION', 'AUTHORIZATION_LETTER'];
  return ['GOVERNMENT_AUTHORITY', 'AUTHORIZATION_LETTER'];
}

function evidenceLabel(type: OwnershipEvidenceType): string {
  return ({
    IDENTITY_DOCUMENT: 'Identity document',
    SELFIE: 'Selfie',
    BUSINESS_REGISTRATION: 'Company registration document',
    GOVERNMENT_AUTHORITY: 'Government ownership or authority document',
    AUTHORIZATION_LETTER: 'Authorization letter',
  })[type];
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function TenantOwnershipSetup() {
  const [verification, setVerification] = useState<TenantOwnershipResponse | null>(null);
  const [party, setParty] = useState<OwnershipPartyInput>(initialParty);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      const result = await getMyOwnershipVerification();
      setVerification(result);
      setParty((current) => current.fullName.trim() ? current : ({
        ...current,
        fullName: current.partyType === 'INDIVIDUAL' ? result.defaults.individualName : result.defaults.entityName,
        registrationNumber: current.registrationNumber || result.defaults.registrationNumber,
        registrationCountry: current.registrationCountry || result.defaults.registrationCountry,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load ownership verification.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function addParty(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createOwnershipParty({
        ...party,
        fullName: party.fullName.trim(),
        registrationNumber: party.registrationNumber?.trim() || undefined,
        registrationCountry: party.registrationCountry?.trim() || undefined,
        identityDocumentType: party.identityDocumentType?.trim() || undefined,
      });
      const nextIndividualRole: OwnershipPartyRole = party.partyType === 'LEGAL_ENTITY'
        ? 'DIRECTOR'
        : party.partyType === 'GOVERNMENT_ENTITY'
          ? 'AUTHORIZED_OFFICIAL'
          : 'OWNER';
      setParty({
        ...initialParty,
        partyType: 'INDIVIDUAL',
        role: nextIndividualRole,
      });
      setNotice('Ownership party added. Upload the required evidence for this party.');
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add ownership party.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadEvidence(partyId: string, evidenceType: OwnershipEvidenceType, file?: File): Promise<void> {
    if (!file) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await uploadOwnershipEvidence(partyId, evidenceType, file);
      setNotice('Evidence uploaded privately. File integrity is checked automatically; identity authenticity requires authorized review.');
      await refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload ownership evidence.');
    } finally {
      setSaving(false);
    }
  }

  async function removeEvidence(partyId: string, evidenceId: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await removeOwnershipEvidence(partyId, evidenceId);
      await refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove evidence.');
    } finally {
      setSaving(false);
    }
  }

  async function removePartyRecord(partyId: string): Promise<void> {
    if (!window.confirm('Remove this ownership party and its uploaded evidence?')) return;
    setSaving(true);
    setError(null);
    try {
      await removeOwnershipParty(partyId);
      await refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove ownership party.');
    } finally {
      setSaving(false);
    }
  }

  async function submit(): Promise<void> {
    if (!declarationAccepted) {
      setError('Confirm that the ownership information is complete and accurate before submission.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      setVerification(await submitOwnershipDeclaration(declarationAccepted));
      setNotice('Ownership declaration submitted for authorized review.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit ownership declaration.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="tenant-setup-config-panel tenant-ownership-setup">
      <div>
        <h2>Ownership and control</h2>
        <p>Declare the accountable owner for this tenant. For companies, add directors or beneficial owners. For government facilities, add an authorized official. Evidence is reviewed by an authorized platform reviewer.</p>
      </div>
      {error ? <p className="tenant-setup-config-message is-error" role="alert">{error}</p> : null}
      {notice ? <p className="tenant-setup-config-message" role="status">{notice}</p> : null}
      {loading ? <p role="status">Loading ownership records…</p> : (
        <>
          <p className="tenant-ownership-status">Review status: <strong>{statusLabel(verification?.status ?? 'NOT_STARTED')}</strong></p>
          <form className="tenant-setup-config-grid" onSubmit={(event) => void addParty(event)}>
            <label>Party type<select required value={party.partyType} onChange={(event) => {
              const partyType = event.target.value as OwnershipPartyType;
              setParty((current) => ({
                ...current,
                partyType,
                role: 'OWNER',
                fullName: partyType === 'INDIVIDUAL'
                  ? verification?.defaults.individualName ?? ''
                  : verification?.defaults.entityName ?? '',
                registrationNumber: partyType === 'INDIVIDUAL' ? '' : verification?.defaults.registrationNumber ?? '',
                registrationCountry: verification?.defaults.registrationCountry ?? '',
              }));
            }}>
              <option value="INDIVIDUAL">Individual / sole owner</option>
              <option value="LEGAL_ENTITY">Company / legal entity</option>
              <option value="GOVERNMENT_ENTITY">Government-owned facility</option>
            </select></label>
            {party.partyType === 'INDIVIDUAL' ? <label>Party role<select value={party.role} onChange={(event) => setParty((current) => ({ ...current, role: event.target.value as OwnershipPartyRole }))}>{roleOptions(party.partyType).map((role) => <option value={role} key={role}>{statusLabel(role)}</option>)}</select></label> : null}
            <label>{party.partyType === 'INDIVIDUAL' ? 'Full legal name' : party.partyType === 'LEGAL_ENTITY' ? 'Registered company name' : 'Government entity name'}<input required minLength={2} maxLength={250} value={party.fullName} onChange={(event) => setParty((current) => ({ ...current, fullName: event.target.value }))} /></label>
            {party.partyType !== 'INDIVIDUAL' ? <label>{party.partyType === 'LEGAL_ENTITY' ? 'Company registration number' : 'Government reference number'}<input required maxLength={150} value={party.registrationNumber} onChange={(event) => setParty((current) => ({ ...current, registrationNumber: event.target.value }))} /></label> : null}
            {party.partyType !== 'INDIVIDUAL' ? <label>Registration country<input maxLength={100} value={party.registrationCountry} onChange={(event) => setParty((current) => ({ ...current, registrationCountry: event.target.value }))} /></label> : null}
            {party.partyType === 'INDIVIDUAL' ? <label>Identity document type<select value={party.identityDocumentType} onChange={(event) => setParty((current) => ({ ...current, identityDocumentType: event.target.value }))}><option value="NATIONAL_ID">National ID</option><option value="PASSPORT">Passport</option><option value="ALIEN_ID">Alien ID</option></select></label> : null}
            <button className="tenant-primary-action" type="submit" disabled={saving}><Plus size={16} /> Add ownership party</button>
          </form>

          {verification?.parties.length ? <div className="tenant-ownership-party-list">
            {verification.parties.map((entry) => <article className="tenant-ownership-party" key={entry.id}>
              <header><span><strong>{entry.fullName}</strong><small>{statusLabel(entry.partyType)} · {statusLabel(entry.role)}{entry.registrationNumber ? ` · ${entry.registrationNumber}` : ''}</small></span><span className={`staff-status-badge ${entry.status === 'VERIFIED' ? 'is-verified' : ''}`}>{statusLabel(entry.status)}</span></header>
              {entry.rejectionReason ? <p className="tenant-setup-config-message is-error" role="alert">Reviewer note: {entry.rejectionReason}</p> : null}
              <div className="tenant-ownership-evidence-grid">{evidenceOptions(entry).map((evidenceType) => {
                const existing = entry.evidence.filter((evidence) => evidence.evidenceType === evidenceType);
                return <label key={evidenceType}>{evidenceLabel(evidenceType)}
                  {existing.map((evidence) => <span className="tenant-ownership-evidence-file" key={evidence.id}>{evidence.fileName} · {(evidence.sizeBytes / (1024 * 1024)).toFixed(2)} MB{entry.status !== 'VERIFIED' ? <button type="button" title="Remove evidence" aria-label={`Remove ${evidence.fileName}`} disabled={saving} onClick={() => void removeEvidence(entry.id, evidence.id)}><Trash2 size={14} /></button> : null}</span>)}
                  {entry.status !== 'VERIFIED' ? <span className="tenant-ownership-file-input"><Upload size={15} /><input type="file" accept={evidenceType === 'SELFIE' ? 'image/jpeg,image/png' : 'application/pdf,image/jpeg,image/png'} disabled={saving} onChange={(event) => { void uploadEvidence(entry.id, evidenceType, event.target.files?.[0]); event.currentTarget.value = ''; }} /></span> : null}
                </label>;
              })}</div>
              {entry.status !== 'VERIFIED' ? <button type="button" className="tenant-setup-config-danger" disabled={saving} onClick={() => void removePartyRecord(entry.id)}><Trash2 size={15} /> Remove party</button> : null}
            </article>)}
          </div> : <p className="tenant-setup-config-empty">No ownership parties added.</p>}

          <label className="tenant-ownership-declaration"><input type="checkbox" checked={declarationAccepted} onChange={(event) => setDeclarationAccepted(event.target.checked)} /> I declare that these owners, directors, beneficial owners, or authorized officials are complete and accurate for this facility.</label>
          <button type="button" className="tenant-primary-action" disabled={saving || !verification?.parties.length || ['PENDING_REVIEW', 'VERIFIED'].includes(verification.status)} onClick={() => void submit()}><Send size={16} /> {saving ? 'Submitting…' : 'Submit for verification'}</button>
        </>
      )}
    </section>
  );
}