import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, LoaderCircle, Save } from 'lucide-react';
import { getBranches } from '../../branches/api/branches.api.js';
import type { Branch } from '../../branches/types/branch.types.js';
import { TenantOwnershipSetup } from './TenantOwnershipSetup.js';
import {
  acceptTenantTerms,
  createOperationalResource,
  getTenantSetupSettings,
  saveBookingPolicy,
  savePaymentConfig,
  uploadTenantComplianceDocument,
  type TenantSetupSettings,
} from '../api/tenant-setup.api.js';
import './TenantSetupConfigPage.css';

type SetupSection = 'booking' | 'payments' | 'resources' | 'documents' | 'terms' | 'ownership';

const sections: Array<{ key: SetupSection; title: string }> = [
  { key: 'booking', title: 'Booking rules' },
  { key: 'payments', title: 'Payment preferences' },
  { key: 'resources', title: 'Operational resources' },
  { key: 'documents', title: 'Compliance documents' },
  { key: 'ownership', title: 'Ownership verification' },
  { key: 'terms', title: 'Terms acceptance' },
];

export function TenantSetupConfigPage() {
  const selected = new URLSearchParams(window.location.search).get('section');
  const initialSection = sections.some((section) => section.key === selected)
    ? selected as SetupSection
    : 'booking';
  const [section, setSection] = useState<SetupSection>(initialSection);
  const [settings, setSettings] = useState<TenantSetupSettings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resource, setResource] = useState({ branchId: '', name: '', type: 'ROOM', capacity: '1' });

  async function refresh(): Promise<void> {
    const [nextSettings, nextBranches] = await Promise.all([getTenantSetupSettings(), getBranches()]);
    setSettings(nextSettings);
    setBranches(nextBranches.filter((branch) => branch.status === 'ACTIVE'));
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getTenantSetupSettings(), getBranches()])
      .then(([nextSettings, nextBranches]) => {
        if (cancelled) return;
        setSettings(nextSettings);
        setBranches(nextBranches.filter((branch) => branch.status === 'ACTIVE'));
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load organization settings.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function saveForm(event: FormEvent<HTMLFormElement>, kind: 'booking' | 'payments'): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (kind === 'booking') {
        await saveBookingPolicy({
          minLeadTimeMinutes: Number(form.get('minLeadTimeMinutes')),
          cancellationWindowHours: Number(form.get('cancellationWindowHours')),
          rescheduleWindowHours: Number(form.get('rescheduleWindowHours')),
          maxBookingsPerDay: Number(form.get('maxBookingsPerDay')),
          noShowFeeEnabled: form.get('noShowFeeEnabled') === 'on',
          allowOnlineBooking: form.get('allowOnlineBooking') === 'on',
        });
        setSuccess('Booking rules saved.');
      } else {
        await savePaymentConfig({
          currency: String(form.get('currency')).toUpperCase(),
          acceptCash: form.get('acceptCash') === 'on',
          acceptMpesa: form.get('acceptMpesa') === 'on',
          acceptCard: form.get('acceptCard') === 'on',
          acceptBankTransfer: form.get('acceptBankTransfer') === 'on',
          depositRequired: form.get('depositRequired') === 'on',
          depositPercent: form.get('depositRequired') === 'on' ? Number(form.get('depositPercent')) : null,
          mpesaPaybill: String(form.get('mpesaPaybill') ?? ''),
          bankAccountName: String(form.get('bankAccountName') ?? ''),
          bankAccountNumber: String(form.get('bankAccountNumber') ?? ''),
        });
        setSuccess('Payment preferences saved. No payment gateway was charged or verified.');
      }
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save this configuration.');
    } finally {
      setSaving(false);
    }
  }

  async function addResource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await createOperationalResource({
        ...(resource.branchId ? { branchId: resource.branchId } : {}),
        name: resource.name,
        type: resource.type,
        capacity: Number(resource.capacity),
      });
      setResource({ branchId: '', name: '', type: 'ROOM', capacity: '1' });
      await refresh();
      setSuccess('Operational resource added.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add the resource.');
    } finally {
      setSaving(false);
    }
  }

  async function acceptCurrentTerms(): Promise<void> {
    if (!settings?.currentTermsVersion) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await acceptTenantTerms(settings.currentTermsVersion);
      await refresh();
      setSuccess('Terms acceptance recorded for this administrator.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to record terms acceptance.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Select a document file first.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await uploadTenantComplianceDocument({
        type: String(form.get('type')),
        title: String(form.get('title')),
        documentNumber: String(form.get('documentNumber') ?? '') || undefined,
        issuingAuthority: String(form.get('issuingAuthority') ?? '') || undefined,
        issueDate: String(form.get('issueDate') ?? '') || undefined,
        expiryDate: String(form.get('expiryDate') ?? '') || undefined,
        file,
      });
      formElement.reset();
      await refresh();
      setSuccess('Document uploaded securely and submitted for review.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload this document.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="tenant-setup-config-loading" role="status"><LoaderCircle /> Loading organization settings…</main>;

  return (
    <main className="tenant-setup-config-page">
      <header className="tenant-setup-config-heading">
        <div><p className="dashboard-eyebrow">ORGANIZATION READINESS</p><h1>Configuration</h1><p>Saved settings feed directly into launch readiness.</p></div>
        <a href="/tenant/dashboard">Back to checklist</a>
      </header>
      {error ? <div className="tenant-setup-config-message is-error" role="alert">{error}</div> : null}
      {success ? <div className="tenant-setup-config-message" role="status">{success}</div> : null}
      <nav className="tenant-setup-config-tabs" aria-label="Configuration sections">
        {sections.map((item) => <button type="button" key={item.key} className={section === item.key ? 'active' : ''} onClick={() => { setSection(item.key); window.history.replaceState({}, '', `/tenant/setup?section=${item.key}`); }}>{item.title}</button>)}
      </nav>

      {section === 'booking' ? (
        <form className="tenant-setup-config-panel" onSubmit={(event) => void saveForm(event, 'booking')}>
          <div><h2>Booking and cancellation rules</h2><p>These are policy settings; they do not create availability or payment transactions.</p></div>
          <div className="tenant-setup-config-grid">
            <label>Minimum lead time (minutes)<input name="minLeadTimeMinutes" type="number" min="0" max="10080" required defaultValue={settings?.bookingPolicy?.minLeadTimeMinutes ?? 60} /></label>
            <label>Cancellation window (hours)<input name="cancellationWindowHours" type="number" min="0" max="720" required defaultValue={settings?.bookingPolicy?.cancellationWindowHours ?? 24} /></label>
            <label>Reschedule window (hours)<input name="rescheduleWindowHours" type="number" min="0" max="720" required defaultValue={settings?.bookingPolicy?.rescheduleWindowHours ?? 12} /></label>
            <label>Maximum bookings per day<input name="maxBookingsPerDay" type="number" min="1" max="1000" required defaultValue={settings?.bookingPolicy?.maxBookingsPerDay ?? 10} /></label>
          </div>
          <label className="tenant-setup-config-check"><input name="allowOnlineBooking" type="checkbox" defaultChecked={settings?.bookingPolicy?.allowOnlineBooking ?? false} /> Allow online booking requests</label>
          <label className="tenant-setup-config-check"><input name="noShowFeeEnabled" type="checkbox" defaultChecked={settings?.bookingPolicy?.noShowFeeEnabled ?? false} /> No-show fee policy enabled (fee collection is not configured)</label>
          <button className="tenant-primary-action" type="submit" disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save booking rules'}</button>
        </form>
      ) : null}

      {section === 'payments' ? (
        <form className="tenant-setup-config-panel" onSubmit={(event) => void saveForm(event, 'payments')}>
          <div><h2>Payment preferences</h2><p>Record methods the organization says it accepts. This does not configure or verify a payment gateway.</p></div>
          <label>Currency<input name="currency" required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" defaultValue={settings?.paymentConfig?.currency ?? 'KES'} /></label>
          <div className="tenant-setup-config-options">
            {([['acceptCash', 'Cash'], ['acceptMpesa', 'M-Pesa'], ['acceptCard', 'Card'], ['acceptBankTransfer', 'Bank transfer']] as const).map(([name, label]) => <label className="tenant-setup-config-check" key={name}><input name={name} type="checkbox" defaultChecked={settings?.paymentConfig?.[name] ?? false} /> {label}</label>)}
          </div>
          <label className="tenant-setup-config-check"><input name="depositRequired" type="checkbox" defaultChecked={settings?.paymentConfig?.depositRequired ?? false} /> Deposit required</label>
          <label>Deposit percentage<input name="depositPercent" type="number" min="1" max="100" defaultValue={settings?.paymentConfig?.depositPercent ?? ''} /></label>
          <label>M-Pesa paybill<input name="mpesaPaybill" maxLength={100} defaultValue={settings?.paymentConfig?.mpesaPaybill ?? ''} /></label>
          <label>Bank account name<input name="bankAccountName" maxLength={200} defaultValue={settings?.paymentConfig?.bankAccountName ?? ''} /></label>
          <label>Bank account number<input name="bankAccountNumber" maxLength={100} defaultValue={settings?.paymentConfig?.bankAccountNumber ?? ''} /></label>
          <button className="tenant-primary-action" type="submit" disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save preferences'}</button>
        </form>
      ) : null}

      {section === 'resources' ? (
        <section className="tenant-setup-config-panel">
          <div><h2>Operational resources</h2><p>Resources are configuration records only. They are not yet linked to capacity reservations.</p></div>
          <form className="tenant-setup-config-grid" onSubmit={(event) => void addResource(event)}>
            <label>Resource name<input required maxLength={200} value={resource.name} onChange={(event) => setResource((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>Type<select value={resource.type} onChange={(event) => setResource((current) => ({ ...current, type: event.target.value }))}><option value="ROOM">Room</option><option value="EQUIPMENT">Equipment</option><option value="BED">Bed</option><option value="VEHICLE">Vehicle</option><option value="OTHER">Other</option></select></label>
            <label>Branch<select value={resource.branchId} onChange={(event) => setResource((current) => ({ ...current, branchId: event.target.value }))}><option value="">Organization-wide</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label>Capacity<input type="number" min="1" max="10000" required value={resource.capacity} onChange={(event) => setResource((current) => ({ ...current, capacity: event.target.value }))} /></label>
            <button className="tenant-primary-action" type="submit" disabled={saving}><Save size={16} /> Add resource</button>
          </form>
          {settings?.resources.length ? <div className="tenant-setup-resource-list">{settings.resources.map((item) => <article key={item.id}><strong>{item.name}</strong><span>{item.type} · capacity {item.capacity}{item.isActive ? '' : ' · inactive'}</span></article>)}</div> : <p className="tenant-setup-config-empty">No active operational resources configured.</p>}
        </section>
      ) : null}

      {section === 'documents' ? (
        <section className="tenant-setup-config-panel">
          <div><h2>Facility permits and licenses</h2><p>Uploaded files are private. They remain pending until an authorized Revaltrix reviewer approves them.</p></div>
          <form className="tenant-setup-config-grid" onSubmit={(event) => void uploadDocument(event)}>
            <label>Document type<select name="type" required><option value="BUSINESS_PERMIT">Facility permit</option><option value="HEALTHCARE_FACILITY_LICENSE">Healthcare facility license</option><option value="REGISTRATION_CERTIFICATE">Registration certificate</option><option value="INCORPORATION_CERTIFICATE">Incorporation certificate</option></select></label>
            <label>Document title<input name="title" required maxLength={200} /></label>
            <label>Document number<input name="documentNumber" maxLength={150} /></label>
            <label>Issuing authority<input name="issuingAuthority" maxLength={200} /></label>
            <label>Issue date<input name="issueDate" type="date" /></label>
            <label>Expiry date<input name="expiryDate" type="date" /></label>
            <label className="tenant-setup-config-field-wide">File<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>
            <button className="tenant-primary-action" type="submit" disabled={saving}><Save size={16} /> {saving ? 'Uploading…' : 'Upload for review'}</button>
          </form>
          {settings?.documents.length ? <div className="tenant-setup-resource-list">{settings.documents.map((document) => <article key={document.id}><strong>{document.title}</strong><span>{document.type.replaceAll('_', ' ')} · {document.status.replaceAll('_', ' ')} · {document.verificationStatus.replaceAll('_', ' ')}{document.expiryDate ? ` · expires ${new Date(document.expiryDate).toLocaleDateString()}` : ''}{document.rejectionReason ? ` · ${document.rejectionReason}` : ''}</span></article>)}</div> : <p className="tenant-setup-config-empty">No compliance documents submitted.</p>}
        </section>
      ) : null}

      {section === 'terms' ? (
        <section className="tenant-setup-config-panel">
          <div><h2>Terms acceptance</h2><p>Acceptance is recorded against the current platform terms version and signed-in administrator.</p></div>
          {settings?.currentTermsVersion ? <p>Current version: <strong>{settings.currentTermsVersion}</strong></p> : null}
          <p className="tenant-setup-config-legal-links"><a href={settings?.termsUrl ?? '/terms'} target="_blank" rel="noreferrer">Read Terms of Service</a><a href={settings?.privacyUrl ?? '/privacy'} target="_blank" rel="noreferrer">Read Privacy Policy</a></p>
          {settings?.compliance?.termsAcceptedAt ? <p className="tenant-setup-config-message"><CheckCircle2 size={16} /> Version {settings.compliance.termsVersion} accepted at {new Date(settings.compliance.termsAcceptedAt).toLocaleString()}.</p> : <button type="button" className="tenant-primary-action" disabled={saving || !settings?.currentTermsVersion} onClick={() => void acceptCurrentTerms()}><CheckCircle2 size={16} /> Accept current terms</button>}
        </section>
      ) : null}

      {section === 'ownership' ? <TenantOwnershipSetup /> : null}
    </main>
  );
}