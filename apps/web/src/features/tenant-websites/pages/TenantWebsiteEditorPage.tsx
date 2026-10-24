import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Eye, FileText, Globe2, History, Image, LoaderCircle, Plus, RotateCcw, Save, Send, User, X } from 'lucide-react';
import { getTenantSetup } from '../../dashboard/api/tenant-setup.api.js';
import { requirementRoutes } from '../../dashboard/requirement-routes.js';
import type { TenantSetupResponse } from '../../dashboard/types/tenant-setup.types.js';
import {
  getMyWebsite,
  getWebsiteEnquiries,
  publishMyWebsite,
  restoreMyWebsiteRevision,
  saveMyWebsite,
  setWebsiteEnquiryStatus,
  unpublishMyWebsite,
  uploadGalleryImage,
  type TenantWebsiteAdminResponse,
  type WebsiteEnquiry,
} from '../api/tenant-websites.api.js';
import './TenantWebsiteEditorPage.css';

type EditorTab = 'content' | 'services' | 'launch' | 'enquiries' | 'history';

export function TenantWebsiteEditorPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [data, setData] = useState<TenantWebsiteAdminResponse | null>(null);
  const [readiness, setReadiness] = useState<TenantSetupResponse | null>(null);
  const [enquiries, setEnquiries] = useState<WebsiteEnquiry[]>([]);
  const [tab, setTab] = useState<EditorTab>('content');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [galleryUploading, setGalleryUploading] = useState<string | null>(null);
  const [galleryUploadError, setGalleryUploadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMyWebsite()
      .then((response) => { if (!cancelled) setData(response); })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load website settings.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getTenantSetup()
      .then((result) => { if (!cancelled) setReadiness(result); })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load launch readiness.');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tab !== 'enquiries') return;
    let cancelled = false;
    void getWebsiteEnquiries()
      .then((items) => { if (!cancelled) setEnquiries(items); })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load enquiries.');
      });
    return () => { cancelled = true; };
  }, [tab]);

  async function runAction(action: () => Promise<TenantWebsiteAdminResponse>, success: string): Promise<void> {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      setData(await action());
      setMessage(success);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Website request failed.');
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!data) return;
    const imageUrlRegex = /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (formElement.dataset.section === 'services') {
      await runAction(() => saveMyWebsite({
        branchIds: form.getAll('branchIds').map(String),
        serviceIds: form.getAll('serviceIds').map(String),
        providerIds: form.getAll('providerIds').map(String),
      }), 'Public branches, services, and care team saved.');
      return;
    }
    const faqs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-faq-row]'))
      .map((row) => ({
        question: row.querySelector<HTMLInputElement>('[name="faq-question"]')?.value.trim() ?? '',
        answer: row.querySelector<HTMLTextAreaElement>('[name="faq-answer"]')?.value.trim() ?? '',
      }))
      .filter((faq) => faq.question && faq.answer);
    await runAction(() => saveMyWebsite({
      slug: String(form.get('slug') ?? data.website.slug),
      tagline: String(form.get('tagline') ?? ''),
      heroTitle: String(form.get('heroTitle') ?? ''),
      heroDescription: String(form.get('heroDescription') ?? ''),
      description: String(form.get('description') ?? ''),
      primaryColor: String(form.get('primaryColor') ?? ''),
      secondaryColor: String(form.get('secondaryColor') ?? ''),
      logoUrl: String(form.get('logoUrl') ?? ''),
      heroImageUrl: String(form.get('heroImageUrl') ?? ''),
      contactPhone: String(form.get('contactPhone') ?? ''),
      contactEmail: String(form.get('contactEmail') ?? ''),
      whatsapp: String(form.get('whatsapp') ?? ''),
      emergencyPhone: String(form.get('emergencyPhone') ?? ''),
      emergencyMessage: String(form.get('emergencyMessage') ?? ''),
      facebookUrl: String(form.get('facebookUrl') ?? ''),
      instagramUrl: String(form.get('instagramUrl') ?? ''),
      linkedinUrl: String(form.get('linkedinUrl') ?? ''),
      seoTitle: String(form.get('seoTitle') ?? ''),
      seoDescription: String(form.get('seoDescription') ?? ''),
      openGraphTitle: String(form.get('openGraphTitle') ?? ''),
      openGraphDescription: String(form.get('openGraphDescription') ?? ''),
      canonicalUrl: String(form.get('canonicalUrl') ?? ''),
      socialShareImageUrl: String(form.get('socialShareImageUrl') ?? ''),
      faviconUrl: String(form.get('faviconUrl') ?? ''),
      googleBusinessProfileUrl: String(form.get('googleBusinessProfileUrl') ?? ''),
      keywords: String(form.get('keywords') ?? '').split(',').map((keyword) => keyword.trim()).filter(Boolean).slice(0, 20),
      branchIds: data.website.draftContent.branchIds,
      serviceIds: data.website.draftContent.serviceIds,
      faqs,
      gallery: Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-gallery-row]')).map((row) => ({
        id: row.querySelector<HTMLInputElement>('[name="gallery-id"]')?.value.trim() || crypto.randomUUID(),
        title: row.querySelector<HTMLInputElement>('[name="gallery-title"]')?.value.trim() ?? '',
        description: row.querySelector<HTMLTextAreaElement>('[name="gallery-description"]')?.value.trim() ?? '',
        url: row.querySelector<HTMLInputElement>('[name="gallery-url"]')?.value.trim() ?? '',
      })).filter((image) => image.url && imageUrlRegex.test(image.url)),
      about: {
        title: String(form.get('aboutTitle') ?? content.about.title),
        description: String(form.get('aboutDescription') ?? content.about.description),
        imageUrl: String(form.get('aboutImageUrl') ?? content.about.imageUrl),
      },
      terms: String(form.get('terms') ?? ''),
      policy: String(form.get('policy') ?? ''),
    }), 'Draft saved.');
  }

  async function changeEnquiry(enquiryId: string, status: 'READ' | 'RESOLVED'): Promise<void> {
    try {
      await setWebsiteEnquiryStatus(enquiryId, status);
      setEnquiries(await getWebsiteEnquiries());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update enquiry.');
    }
  }

  if (loading) return <main className="website-editor-loading" role="status"><LoaderCircle className="website-spin" /> Loading website settings…</main>;
  if (!data) {
    return (
      <main className="website-editor-page">
        <section className="website-editor-empty"><h1>Website settings unavailable</h1><p>{error ?? 'Unable to load organization website settings.'}</p><button type="button" onClick={() => onNavigate('/tenant/dashboard')}>Return to dashboard</button></section>
      </main>
    );
  }

  const content = data.website.draftContent;
  const hasUnpublishedChanges = data.website.publishedRevision !== data.website.revision;
  const publishDisabled = saving || !readiness?.summary.ready || !['READY', 'LIVE'].includes(readiness.setup.status);
  const addFaq = () => setData((current) => current ? {
    ...current,
    website: { ...current.website, draftContent: { ...current.website.draftContent, faqs: [...current.website.draftContent.faqs, { question: '', answer: '' }] } },
  } : current);
  const removeFaq = (index: number) => setData((current) => current ? {
    ...current,
    website: { ...current.website, draftContent: { ...current.website.draftContent, faqs: current.website.draftContent.faqs.filter((_, itemIndex) => itemIndex !== index) } },
  } : current);

  const addGalleryImage = () => setData((current) => current ? {
    ...current,
    website: { ...current.website, draftContent: { ...current.website.draftContent, gallery: [...(current.website.draftContent.gallery ?? []), { id: crypto.randomUUID(), title: '', description: '', url: '' }] } },
  } : current);

  const removeGalleryImage = (index: number) => setData((current) => current ? {
    ...current,
    website: { ...current.website, draftContent: { ...current.website.draftContent, gallery: (current.website.draftContent.gallery ?? []).filter((_, itemIndex) => itemIndex !== index) } },
  } : current);

  async function uploadGalleryImageForRow(index: number, file: File) {
    setGalleryUploading(content.gallery?.[index]?.id ?? `new-${index}`);
    setGalleryUploadError(null);
    try {
      const { url } = await uploadGalleryImage(file);
      setData((current) => current ? {
        ...current,
        website: { ...current.website, draftContent: { ...current.website.draftContent, gallery: (current.website.draftContent.gallery ?? []).map((img, i) => i === index ? { ...img, url } : img) } },
      } : current);
    } catch (err) {
      setGalleryUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setGalleryUploading(null);
    }
  }

  const galleryCount = (content.gallery ?? []).length;
  const maxGalleryImages = 15;

  return (
    <main className="website-editor-page">
      <header className="website-editor-heading">
        <div>
          <p className="dashboard-eyebrow">ORGANIZATION WEBSITE</p>
          <h1>Website</h1>
          <p>Manage your shared public site, its approved services, and incoming enquiries.</p>
        </div>
        <div className="website-editor-actions">
          <a className="website-editor-secondary" href={data.previewUrl} target="_blank" rel="noreferrer"><Eye size={16} /> Preview draft</a>
          {data.publicUrl ? <a className="website-editor-secondary" href={data.publicUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={16} /> Open website</a> : null}
          {data.website.status === 'PUBLISHED' ? (
            <>
              {hasUnpublishedChanges ? <button type="button" className="website-editor-primary" disabled={publishDisabled} title={!readiness?.summary.ready ? 'Complete all required launch checks first.' : undefined} onClick={() => void runAction(publishMyWebsite, 'Website updates published. Public appointment discovery now uses the new branch, service, and care-team selections.')}><Send size={16} /> Publish updates</button> : null}
              <button type="button" className="website-editor-danger" disabled={saving} onClick={() => void runAction(unpublishMyWebsite, 'Website unpublished.')}><X size={16} /> Unpublish</button>
            </>
          ) : (
            <button type="button" className="website-editor-primary" disabled={publishDisabled} title={!readiness?.summary.ready ? 'Complete all required launch checks first.' : undefined} onClick={() => void runAction(publishMyWebsite, 'Website published.')}><Send size={16} /> Publish</button>
          )}
        </div>
      </header>

      {error ? <div className="website-editor-alert is-error" role="alert">{error}</div> : null}
      {message ? <div className="website-editor-alert" role="status">{message}</div> : null}

      <section className="website-editor-statusline">
        <span className={`website-status-dot ${data.website.status.toLowerCase()}`} />
        <strong>{data.website.status === 'PUBLISHED' ? 'Published' : data.website.status === 'UNPUBLISHED' ? 'Unpublished' : 'Draft'}</strong>
        <span>{data.website.status === 'PUBLISHED' ? data.publicUrl : `Preview: ${data.previewUrl}`}</span>
        {hasUnpublishedChanges ? <span role="status">Draft changes are not public yet</span> : null}
        <span className="website-readiness">Launch readiness {data.launchReadiness?.readinessPercent ?? 0}% · {data.launchReadiness?.status ?? 'NOT_STARTED'}</span>
      </section>

      <nav className="website-editor-tabs" aria-label="Website management">
        {([['content', 'Content'], ['services', 'Services & branches'], ['launch', 'Launch checklist'], ['enquiries', 'Enquiries'], ['history', 'Revisions']] as const).map(([key, label]) => (
          <button type="button" key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {tab === 'content' ? (
          <form key={data.website.revision} className="website-editor-form" data-section="content" onSubmit={(event) => void save(event)}>
          <section className="website-editor-section">
            <header><div><h2>Identity and contact</h2><p>Legal organization data stays in your organization profile.</p></div></header>
            <div className="website-editor-fields">
              <label>Website address<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={180} defaultValue={data.website.slug} /><small>/sites/{data.website.slug}</small></label>
              <label>Organization<input value={data.tenant.name} disabled /></label>
              <label>Public phone<input name="contactPhone" maxLength={50} defaultValue={content.contactPhone || data.tenant.profile?.contactPhone || ''} /></label>
              <label>Public email<input name="contactEmail" type="email" maxLength={320} defaultValue={content.contactEmail || data.tenant.profile?.contactEmail || ''} /></label>
              <label>WhatsApp<input name="whatsapp" maxLength={50} defaultValue={content.whatsapp} placeholder="Optional contact number" /></label>
              <label>Emergency phone<input name="emergencyPhone" maxLength={50} defaultValue={content.emergencyPhone} /></label>
              <label>Emergency message<input name="emergencyMessage" maxLength={300} defaultValue={content.emergencyMessage} /></label>
              <label>Facebook URL<input name="facebookUrl" type="url" maxLength={500} defaultValue={content.facebookUrl} placeholder="https://…" /></label>
              <label>Instagram URL<input name="instagramUrl" type="url" maxLength={500} defaultValue={content.instagramUrl} placeholder="https://…" /></label>
              <label>LinkedIn URL<input name="linkedinUrl" type="url" maxLength={500} defaultValue={content.linkedinUrl} placeholder="https://…" /></label>
              <label className="wide">Google Business Profile URL<input name="googleBusinessProfileUrl" type="url" maxLength={1000} defaultValue={content.googleBusinessProfileUrl} placeholder="https://…" /></label>
              <label>Tagline<input name="tagline" maxLength={180} defaultValue={content.tagline} /></label>
            </div>
          </section>

          <section className="website-editor-section">
            <header><div><h2>Homepage</h2><p>Only verified organization records and your submitted public content are shown.</p></div></header>
            <div className="website-editor-fields">
              <label>Hero heading<input name="heroTitle" required maxLength={200} defaultValue={content.heroTitle || data.tenant.name} /></label>
              <label>Hero description<textarea name="heroDescription" maxLength={1000} rows={3} defaultValue={content.heroDescription} /></label>
              <label className="wide">Public description<textarea name="description" maxLength={2000} rows={4} defaultValue={content.description || data.tenant.profile?.description || ''} /></label>
              <label>Logo image URL<input name="logoUrl" type="url" placeholder="https://…" defaultValue={content.logoUrl} /></label>
              <label>Hero image URL<input name="heroImageUrl" type="url" placeholder="https://…" defaultValue={content.heroImageUrl} /></label>
              <label>Primary brand colour<input name="primaryColor" type="color" defaultValue={content.primaryColor} /></label>
              <label>Soft brand colour<input name="secondaryColor" type="color" defaultValue={content.secondaryColor} /></label>
            </div>
          </section>

          <section className="website-editor-section">
            <header><div><h2>Search and sharing</h2><p>Page metadata for search results and social previews.</p></div></header>
            <div className="website-editor-fields">
              <label>SEO title<input name="seoTitle" maxLength={200} defaultValue={content.seoTitle || data.tenant.name} /></label>
              <label>SEO description<textarea name="seoDescription" maxLength={320} rows={2} defaultValue={content.seoDescription} /></label>
              <label>Social sharing title<input name="openGraphTitle" maxLength={200} defaultValue={content.openGraphTitle || content.seoTitle || data.tenant.name} /></label>
              <label>Social sharing description<textarea name="openGraphDescription" maxLength={320} rows={2} defaultValue={content.openGraphDescription || content.seoDescription} /></label>
              <label>Canonical URL<input name="canonicalUrl" type="url" maxLength={1000} defaultValue={content.canonicalUrl} placeholder="https://…" /></label>
              <label>Social sharing image URL<input name="socialShareImageUrl" type="url" maxLength={1000} defaultValue={content.socialShareImageUrl} placeholder="https://…" /></label>
              <label>Favicon URL<input name="faviconUrl" type="url" maxLength={1000} defaultValue={content.faviconUrl} placeholder="https://…" /></label>
              <label>Search keywords<input name="keywords" maxLength={1200} defaultValue={content.keywords.join(', ')} placeholder="clinic, family care, ..." /></label>
            </div>
          </section>

          <section className="website-editor-section">
            <header><div><h2>Frequently asked questions</h2><p>Answers are published exactly as submitted.</p></div><button type="button" className="website-editor-small-action" onClick={addFaq}><Plus size={15} /> Add question</button></header>
            {content.faqs?.length ? <div className="website-editor-faq-list">{content.faqs.map((faq, index) => (
              <div className="website-editor-faq" data-faq-row key={`faq-${index}`}>
                <label>Question<input name="faq-question" maxLength={200} defaultValue={faq.question} /></label>
                <label>Answer<textarea name="faq-answer" maxLength={1000} rows={2} defaultValue={faq.answer} /></label>
                <button type="button" className="website-editor-icon-action" aria-label="Remove question" onClick={() => removeFaq(index)}><X size={16} /></button>
              </div>
            ))}</div> : <p className="website-editor-muted">No questions added.</p>}
          </section>

          <section className="website-editor-section">
            <header><div><h2>Gallery</h2><p>Upload or link images to showcase on the public website gallery page. Images must use HTTPS URLs.</p></div><button type="button" className="website-editor-small-action" onClick={addGalleryImage} disabled={galleryCount >= maxGalleryImages}>{galleryCount >= maxGalleryImages ? "Limit reached (15)" : <><Image size={15} /> Add image</>}</button></header>
            {content.gallery?.length ? <div className="website-editor-gallery-list">{content.gallery.map((image, index) => (
              <div className="website-editor-gallery" data-gallery-row key={image.id}>
                <label>Image title<input name="gallery-title" maxLength={200} defaultValue={image.title} /></label>
                <label>Description<textarea name="gallery-description" maxLength={1000} rows={2} defaultValue={image.description} /></label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ flex: 1 }}>Image URL<input name="gallery-url" type="url" maxLength={1000} defaultValue={image.url} placeholder="https://…" pattern="https?://.+\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$" title="Image URL must end with .jpg, .jpeg, .png, .webp, .gif, or .svg" /></label>
                  <label style={{ flex: '0 0 auto' }}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                      onChange={(event) => { const f = event.target?.files?.[0]; if (f) uploadGalleryImageForRow(index, f); }}
                      disabled={galleryUploading === image.id || galleryUploading === ("new-" + index)}
                    />
                  </label>
                </div>
                {galleryUploading === image.id || galleryUploading === `new-${index}` ? <span style={{ fontSize: 11, color: '#276b52' }}>Uploading…</span> : null}
                {galleryUploadError && galleryUploadError.includes(image.id) ? <span style={{ fontSize: 11, color: '#974432' }}>{galleryUploadError}</span> : null}
                <input name="gallery-id" type="hidden" defaultValue={image.id} />
                <button type="button" className="website-editor-icon-action" aria-label="Remove image" onClick={() => removeGalleryImage(index)}><X size={16} /></button>
              </div>
            ))}</div> : <p className="website-editor-muted">No gallery images added.</p>}
          </section>

          <section className="website-editor-section">
            <header><div><h2>About</h2><p>Organization profile shown on the About page.</p></div></header>
            <div className="website-editor-fields">
              <label>About title<input name="aboutTitle" maxLength={200} defaultValue={content.about?.title ?? ""} /></label>
              <label>About description<textarea name="aboutDescription" maxLength={5000} rows={4} defaultValue={content.about?.description ?? ""} /></label>
              <label className="wide">About image URL<input name="aboutImageUrl" type="url" maxLength={1000} defaultValue={content.about?.imageUrl ?? ""} placeholder="https://…" /></label>
            </div>
          </section>

          <section className="website-editor-section">
            <header><div><h2>Terms of Service</h2><p>Optional. If left blank, the website uses the platform terms page.</p></div></header>
            <div className="website-editor-fields">
              <label className="wide">Terms of Service<textarea name="terms" maxLength={10000} rows={6} defaultValue={content.terms} placeholder="Your organization's terms of service…" /></label>
            </div>
          </section>

          <section className="website-editor-section">
            <header><div><h2>Privacy Policy</h2><p>Optional. If left blank, the website uses the platform privacy policy page.</p></div></header>
            <div className="website-editor-fields">
              <label className="wide">Privacy Policy<textarea name="policy" maxLength={10000} rows={6} defaultValue={content.policy} placeholder="Your organization's privacy policy…" /></label>
            </div>
          </section>

          <footer className="website-editor-form-footer">
            <span>Draft revision {data.website.revision} · Last saved {new Date(data.website.updatedAt).toLocaleString()}</span>
            <button type="submit" className="website-editor-primary" disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save draft'}</button>
          </footer>
        </form>
      ) : null}

      {tab === 'services' ? (
        <form key={data.website.revision} className="website-editor-form" data-section="services" onSubmit={(event) => void save(event)}>
          <section className="website-editor-section">
            <header><div><h2>Public branches</h2><p>Only active branches can be displayed. Address and hours come from branch configuration.</p></div></header>
            {data.branches.length ? <div className="website-editor-choice-list">{data.branches.map((branch) => (
              <label className="website-editor-choice" key={branch.id}><input type="checkbox" name="branchIds" value={branch.id} defaultChecked={content.branchIds.includes(branch.id)} /><span><strong>{branch.name}</strong><small>{[branch.address, branch.town, branch.county].filter(Boolean).join(', ') || 'Address not configured'} · {branch.openingTime && branch.closingTime ? `${branch.openingTime}–${branch.closingTime}` : 'Hours not configured'}</small></span></label>
            ))}</div> : <p className="website-editor-muted">Add an active branch before selecting public locations. <button type="button" onClick={() => onNavigate('/tenant/branches')}>Configure branches</button></p>}
          </section>
          <section className="website-editor-section">
            <header><div><h2>Public services</h2><p>Service names, prices, durations and branch availability are read from the operational service records.</p></div></header>
            {data.services.length ? <div className="website-editor-choice-list">{data.services.map((service) => (
              <label className="website-editor-choice" key={service.id}><input type="checkbox" name="serviceIds" value={service.id} defaultChecked={content.serviceIds.includes(service.id)} /><span><strong>{service.name}</strong><small>{service.durationMin ? `${service.durationMin} minutes` : 'Duration not configured'} · {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'KES' }).format(Number(service.price))} · {service.branchId ? data.branches.find((branch) => branch.id === service.branchId)?.name ?? 'Assigned branch' : 'Available at configured branches'}</small></span></label>
            ))}</div> : <p className="website-editor-muted">No active services configured. <button type="button" onClick={() => onNavigate('/tenant/services')}>Configure services</button></p>}
          </section>
          <section className="website-editor-section">
            <header><div><h2>Public care team</h2><p>Only selected active provider names, titles and specialties appear. Credentials are not represented as verified here.</p></div><button type="button" className="website-editor-secondary" onClick={() => onNavigate('/tenant/providers')}>Configure providers</button></header>
            {data.providers.length ? <div className="website-editor-choice-list">{data.providers.map((provider) => (
              <label className="website-editor-choice" key={provider.id}><input type="checkbox" name="providerIds" value={provider.id} defaultChecked={content.providerIds.includes(provider.id)} /><span><strong>{provider.user.displayName}</strong><small>{[provider.professionalTitle, provider.specialty].filter(Boolean).join(' · ') || 'Provider profile'}{provider.hasAvailability ? ' · active availability configured' : ' · no active availability'}</small></span></label>
            ))}</div> : <p className="website-editor-muted">No active provider profiles are available to publish.</p>}
          </section>
          <footer className="website-editor-form-footer"><span>Unselected records remain private on the public site.</span><button type="submit" className="website-editor-primary" disabled={saving}><Save size={16} /> Save visibility</button></footer>
        </form>
      ) : null}

      {tab === 'launch' ? (
        <section className="website-editor-section website-launch-checklist">
          <header><div><h2>Website launch checklist</h2><p>These checks use the organization’s shared persisted readiness data. Public publishing remains blocked until all required checks pass and the organization is READY or LIVE.</p></div>
            {readiness ? <strong>{readiness.summary.completed}/{readiness.summary.total} complete</strong> : null}
          </header>
          {!readiness ? <p className="website-editor-muted" role="status">Loading current organization readiness…</p> : (
            <div className="website-launch-rows">
              {readiness.requirements.map((requirement) => {
                const route = requirement.ctaRoute ?? requirementRoutes[requirement.key];
                return (
                  <article className="website-launch-row" key={requirement.key}>
                    <span className={`website-launch-check ${requirement.status === 'COMPLETE' ? 'complete' : ''}`} aria-hidden="true">{requirement.status === 'COMPLETE' ? '✓' : '○'}</span>
                    <div><strong>{requirement.label}</strong><small>{requirement.status.replaceAll('_', ' ')} · {requirement.progress}%{requirement.missing.length ? ` · Missing: ${requirement.missing.join(', ')}` : ''}</small></div>
                    {route ? <button type="button" onClick={() => onNavigate(route)}>{requirement.complete ? 'Review' : requirement.ctaLabel}</button> : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'enquiries' ? (
        <section className="website-editor-section website-editor-enquiries">
          <header><div><h2>Website enquiries</h2><p>Messages submitted from the published contact form.</p></div></header>
          {enquiries.length ? enquiries.map((enquiry) => (
            <article className="website-enquiry" key={enquiry.id}>
              <div><strong>{enquiry.name}</strong><span>{[enquiry.email, enquiry.phone].filter(Boolean).join(' · ')}</span><small>{new Date(enquiry.createdAt).toLocaleString()} · {enquiry.status}</small></div>
              <p>{enquiry.message}</p>
              <div className="website-enquiry-actions">{enquiry.status === 'NEW' ? <button type="button" onClick={() => void changeEnquiry(enquiry.id, 'READ')}>Mark read</button> : null}{enquiry.status !== 'RESOLVED' ? <button type="button" onClick={() => void changeEnquiry(enquiry.id, 'RESOLVED')}>Resolve</button> : null}</div>
            </article>
          )) : <p className="website-editor-muted">No enquiries received.</p>}
        </section>
      ) : null}

      {tab === 'history' ? (
        <section className="website-editor-section website-editor-revisions">
          <header><div><h2>Draft revisions</h2><p>Each saved draft can be restored without changing the published version.</p></div><History size={20} /></header>
          {data.revisions.length ? data.revisions.map((revision) => (
            <article key={revision.id}><span><strong>Revision {revision.revision}</strong><small>{revision.slug} · {new Date(revision.createdAt).toLocaleString()}</small></span><button type="button" className="website-editor-small-action" disabled={saving} onClick={() => void runAction(() => restoreMyWebsiteRevision(revision.id), `Revision ${revision.revision} restored as a new draft.`)}><RotateCcw size={15} /> Restore</button></article>
          )) : <p className="website-editor-muted">No saved revisions yet. Save a draft to create the first revision.</p>}
        </section>
      ) : null}
    </main>
  );
}