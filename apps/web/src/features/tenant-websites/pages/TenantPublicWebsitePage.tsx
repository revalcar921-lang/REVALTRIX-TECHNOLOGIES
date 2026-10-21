import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowRight, Check, Clock3, MapPin, Menu, Phone, Send, X } from 'lucide-react';
import { getAuthSession } from '../../auth/api/auth-session.js';
import {
  bookWebsiteAppointment,
  getMyWebsite,
  getPublicWebsite,
  getWebsiteSlots,
  submitWebsiteEnquiry,
  type PublicTenantWebsite,
  type TenantWebsiteAdminResponse,
  type WebsiteSlot,
} from '../api/tenant-websites.api.js';
import './TenantPublicWebsitePage.css';

interface TenantPublicWebsitePageProps {
  slug: string;
  preview?: boolean;
  onNavigate: (path: string) => void;
}

export function TenantPublicWebsitePage({ slug, preview = false, onNavigate }: TenantPublicWebsitePageProps) {
  const [website, setWebsite] = useState<PublicTenantWebsite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [contactStatus, setContactStatus] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [slots, setSlots] = useState<WebsiteSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<WebsiteSlot | null>(null);
  const [slotBusy, setSlotBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingMessage, setBookingMessage] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = preview
      ? getMyWebsite().then(projectDraftWebsite)
      : getPublicWebsite(slug);
    void load
      .then((response) => { if (!cancelled) setWebsite(response); })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Website is unavailable.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, preview]);

  useEffect(() => {
    if (!website) return;
    const previousTitle = document.title;
    document.title = website.content.seoTitle || website.organization.name;
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.append(description);
    }
    const previousDescription = description.content;
    description.content = website.content.seoDescription || website.organization.description || website.organization.name;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement('link');
    const createdCanonical = !canonical.isConnected;
    canonical.rel = 'canonical';
    canonical.href = `${window.location.origin}/sites/${website.slug}`;
    if (createdCanonical) document.head.append(canonical);
    const socialMetadata = [
      ['og:title', website.content.seoTitle || website.organization.name],
      ['og:description', website.content.seoDescription || website.organization.description || website.organization.name],
      ['og:type', 'website'],
      ...(website.content.heroImageUrl ? [['og:image', website.content.heroImageUrl]] : []),
    ];
    const previousSocialValues = socialMetadata.map(([property]) => {
      const element = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      return { property, element, content: element?.content ?? null };
    });
    for (const [property, value] of socialMetadata) {
      let element = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute('property', property!);
        document.head.append(element);
      }
      element.content = value!;
    }
    return () => {
      document.title = previousTitle;
      description!.content = previousDescription;
      if (createdCanonical) canonical.remove();
      for (const previous of previousSocialValues) {
        if (!previous.element) {
          document.querySelector(`meta[property="${previous.property}"]`)?.remove();
        } else if (previous.content !== null) {
          previous.element.content = previous.content;
        }
      }
    };
  }, [website]);

  useEffect(() => {
    if (!website || !selectedServiceId) {
      setSlots([]);
      setSelectedSlot(null);
      return;
    }
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    let cancelled = false;
    setSlotBusy(true);
    setBookingError(null);
    void getWebsiteSlots(website.slug, {
      serviceId: selectedServiceId,
      ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
      from: from.toISOString(),
      to: to.toISOString(),
    })
      .then((result) => {
        if (!cancelled) {
          setSlots(result);
          setSelectedSlot(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setBookingError(requestError instanceof Error ? requestError.message : 'Availability is unavailable.');
      })
      .finally(() => { if (!cancelled) setSlotBusy(false); });
    return () => { cancelled = true; };
  }, [website, selectedServiceId, selectedBranchId]);

  async function submitContact(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setContactBusy(true);
    setContactError(null);
    setContactStatus(null);
    try {
      const result = await submitWebsiteEnquiry(website!.slug, {
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? '') || undefined,
        phone: String(form.get('phone') ?? '') || undefined,
        message: String(form.get('message') ?? ''),
        website: String(form.get('website') ?? ''),
      });
      if (result.accepted) {
        setContactStatus(`Your enquiry was received. Reference ${result.reference}.`);
        formElement.reset();
      }
    } catch (requestError) {
      setContactError(requestError instanceof Error ? requestError.message : 'Unable to send your enquiry.');
    } finally {
      setContactBusy(false);
    }
  }

  async function bookSlot(): Promise<void> {
    if (!website || !selectedSlot || !selectedServiceId) return;
    if (!getAuthSession()) {
      window.sessionStorage.setItem(
        'revaltrix_site_booking_return_to',
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      onNavigate('/login');
      return;
    }
    setBookingBusy(true);
    setBookingError(null);
    setBookingMessage(null);
    try {
      const appointment = await bookWebsiteAppointment(website.slug, {
        serviceId: selectedServiceId,
        ...(selectedSlot.branchId ? { branchId: selectedSlot.branchId } : {}),
        ...(selectedSlot.departmentId ? { departmentId: selectedSlot.departmentId } : {}),
        providerId: selectedSlot.providerId,
        startAt: selectedSlot.startAt,
        endAt: selectedSlot.endAt,
        timeZone: selectedSlot.timeZone,
      });
      setBookingMessage(`Booking request ${appointment.appointmentNumber} was accepted with status ${appointment.status.replaceAll('_', ' ').toLowerCase()}.`);
      setSelectedSlot(null);
    } catch (requestError) {
      setBookingError(requestError instanceof Error ? requestError.message : 'Unable to book this appointment.');
    } finally {
      setBookingBusy(false);
    }
  }

  if (loading) return <main className="public-site-loading" role="status">Loading organization website…</main>;
  if (error || !website) {
    return <main className="public-site-error"><h1>Website unavailable</h1><p>{error ?? 'This organization has not published its website.'}</p>{preview ? <button type="button" onClick={() => onNavigate('/tenant/website')}>Return to website editor</button> : null}</main>;
  }

  const content = website.content;
  const primaryStyle = { '--site-primary': content.primaryColor, '--site-secondary': content.secondaryColor } as CSSProperties;
  const selectedService = website.services.find((service) => service.id === selectedServiceId);

  return (
    <div className="public-health-site" style={primaryStyle}>
      {preview ? <div className="public-site-preview-banner">Draft preview · not visible to the public</div> : null}
      <header className="public-site-header">
        <a href="#home" className="public-site-brand" aria-label={`${website.organization.name} home`}>
          {content.logoUrl ? <img src={content.logoUrl} alt="" /> : <span className="public-site-mark">{website.organization.name.slice(0, 1).toUpperCase()}</span>}
          <span><strong>{website.organization.name}</strong>{content.tagline ? <small>{content.tagline}</small> : null}</span>
        </a>
        <button className="public-site-mobile-toggle" type="button" aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X /> : <Menu />}</button>
        <nav className={mobileMenuOpen ? 'is-open' : ''} aria-label="Main navigation">
          {website.services.length ? <a href="#services" onClick={() => setMobileMenuOpen(false)}>Services</a> : null}
          {website.branches.length ? <a href="#locations" onClick={() => setMobileMenuOpen(false)}>Locations</a> : null}
          {website.providers.length ? <a href="#team" onClick={() => setMobileMenuOpen(false)}>Care team</a> : null}
          {content.faqs.length ? <a href="#faqs" onClick={() => setMobileMenuOpen(false)}>FAQs</a> : null}
          <a href="#contact" onClick={() => setMobileMenuOpen(false)}>Contact</a>
          {website.bookingAvailable ? <a className="public-site-nav-cta" href="#booking" onClick={() => setMobileMenuOpen(false)}>Book a visit <ArrowRight size={15} /></a> : null}
        </nav>
      </header>

      <main id="home">
        <section className={`public-site-hero ${content.heroImageUrl ? 'has-image' : ''}`}>
          {content.heroImageUrl ? <img className="public-site-hero-image" src={content.heroImageUrl} alt="" /> : null}
          <div className="public-site-hero-inner">
            <p className="public-site-eyebrow">{website.organization.type.replaceAll('_', ' ')}</p>
            <h1>{content.heroTitle || website.organization.name}</h1>
            {content.heroDescription ? <p>{content.heroDescription}</p> : null}
            <div className="public-site-hero-actions">
              {website.bookingAvailable ? <a className="public-site-button-primary" href="#booking">Book an appointment <ArrowRight size={17} /></a> : null}
              {website.organization.contactPhone ? <a className="public-site-button-quiet" href={`tel:${website.organization.contactPhone}`}><Phone size={16} /> Call {website.organization.contactPhone}</a> : null}
            </div>
          </div>
          <div className="public-site-hero-stamp"><span>Care, connected</span><strong>{website.organization.name}</strong></div>
        </section>

        {website.organization.description ? (
          <section className="public-site-intro">
            <div className="public-site-section-kicker">ABOUT THE ORGANIZATION</div>
            <h2>Care shaped around your needs.</h2>
            <p>{website.organization.description}</p>
          </section>
        ) : null}

        {website.services.length ? (
          <section className="public-site-section public-site-services" id="services">
            <div className="public-site-section-heading"><div><p className="public-site-section-kicker">CARE AND SERVICES</p><h2>How we can help</h2></div><span>{website.services.length} active service{website.services.length === 1 ? '' : 's'}</span></div>
            <div className="public-site-service-grid">
              {website.services.map((service, index) => (
                <article className="public-site-service" key={service.id}>
                  <span className="public-site-service-index">{String(index + 1).padStart(2, '0')}</span>
                  <div><h3>{service.name}</h3>{service.description ? <p>{service.description}</p> : null}</div>
                  <div className="public-site-service-meta">
                    {service.durationMin ? <span><Clock3 size={14} /> {service.durationMin} min</span> : null}
                    {Number(service.price) > 0 ? <strong>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'KES' }).format(Number(service.price))}</strong> : null}
                  </div>
                  {website.bookingAvailable ? <a href="#booking" onClick={() => setSelectedServiceId(service.id)}>Book service <ArrowRight size={15} /></a> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {website.branches.length ? (
          <section className="public-site-section public-site-locations" id="locations">
            <div className="public-site-section-heading"><div><p className="public-site-section-kicker">FIND US</p><h2>Our locations</h2></div></div>
            <div className="public-site-branch-grid">
              {website.branches.map((branch) => (
                <article className="public-site-branch" key={branch.id}>
                  <MapPin size={20} /><h3>{branch.name}</h3>
                  {[branch.address, branch.town, branch.county].filter(Boolean).length ? <p>{[branch.address, branch.town, branch.county].filter(Boolean).join(', ')}</p> : null}
                  {branch.contactPhone ? <a href={`tel:${branch.contactPhone}`}>{branch.contactPhone}</a> : null}
                  {branch.openingTime && branch.closingTime ? <p className="public-site-hours">{branch.operatingDays.join(', ')} · {branch.openingTime}–{branch.closingTime}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {website.providers.length ? (
          <section className="public-site-section public-site-team" id="team">
            <div className="public-site-section-heading"><div><p className="public-site-section-kicker">CARE TEAM</p><h2>Meet the team</h2></div></div>
            <div className="public-site-provider-grid">
              {website.providers.map((provider) => (
                <article className="public-site-provider" key={provider.id}>
                  <span aria-hidden="true">{provider.user.displayName.trim().slice(0, 1).toUpperCase()}</span>
                  <h3>{provider.user.displayName}</h3>
                  {provider.professionalTitle ? <p>{provider.professionalTitle}</p> : null}
                  {provider.specialty ? <small>{provider.specialty}</small> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {website.bookingAvailable ? (
          <section className="public-site-booking" id="booking">
            <div className="public-site-booking-copy"><p className="public-site-section-kicker">APPOINTMENT REQUEST</p><h2>Find a time that works for you.</h2><p>Availability is provided by the organization’s live scheduling system. Your request is confirmed only when the server accepts it.</p></div>
            <div className="public-site-booking-form">
              <label>Service<select value={selectedServiceId} onChange={(event) => setSelectedServiceId(event.target.value)}><option value="">Choose a service</option>{website.services.map((service) => <option value={service.id} key={service.id}>{service.name}{service.durationMin ? ` · ${service.durationMin} min` : ''}</option>)}</select></label>
              {website.branches.length ? <label>Location<select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}><option value="">All listed locations</option>{website.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
              {slotBusy ? <p className="public-site-booking-state" role="status">Checking live availability…</p> : null}
              {!slotBusy && selectedServiceId && slots.length ? <div className="public-site-slot-list" role="group" aria-label="Available appointments">{slots.map((slot) => {
                const active = selectedSlot?.startAt === slot.startAt && selectedSlot.providerId === slot.providerId;
                const branchName = website.branches.find((branch) => branch.id === slot.branchId)?.name;
                return <button type="button" className={active ? 'active' : ''} key={`${slot.providerId}-${slot.startAt}`} onClick={() => setSelectedSlot(slot)}><span>{new Date(slot.startAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: slot.timeZone })}</span><small>{[slot.providerTitle, slot.specialty, branchName].filter(Boolean).join(' · ')}</small>{active ? <Check size={16} /> : null}</button>;
              })}</div> : null}
              {!slotBusy && selectedServiceId && !slots.length && !bookingError ? <p className="public-site-booking-state">No available times were returned for this service in the next two weeks.</p> : null}
              {bookingError ? <p className="public-site-inline-error" role="alert">{bookingError}</p> : null}
              {bookingMessage ? <p className="public-site-inline-success" role="status">{bookingMessage}</p> : null}
              {selectedService && selectedSlot ? <div className="public-site-selected-summary"><strong>{selectedService.name}</strong><span>{new Date(selectedSlot.startAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZone: selectedSlot.timeZone })} · {selectedSlot.timeZone}</span></div> : null}
              {selectedServiceId && selectedSlot ? <button type="button" className="public-site-button-primary" disabled={bookingBusy} onClick={() => void bookSlot()}>{bookingBusy ? 'Submitting…' : getAuthSession() ? 'Request this appointment' : 'Sign in to book'} <ArrowRight size={16} /></button> : null}
            </div>
          </section>
        ) : null}

        {content.faqs.length ? (
          <section className="public-site-section public-site-faqs" id="faqs"><div className="public-site-section-heading"><div><p className="public-site-section-kicker">GOOD TO KNOW</p><h2>Frequently asked questions</h2></div></div>{content.faqs.map((faq, index) => <details key={`${faq.question}-${index}`}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</section>
        ) : null}

        <section className="public-site-contact" id="contact"><div><p className="public-site-section-kicker">GET IN TOUCH</p><h2>How can we help?</h2><p>Send a message to the organization. Responses are handled by the organization directly.</p>{website.organization.contactPhone ? <a href={`tel:${website.organization.contactPhone}`}><Phone size={16} /> {website.organization.contactPhone}</a> : null}{website.organization.contactEmail ? <a href={`mailto:${website.organization.contactEmail}`}><Send size={16} /> {website.organization.contactEmail}</a> : null}</div>
            <form onSubmit={(event) => void submitContact(event)}>
              <label>Your name<input name="name" required maxLength={200} autoComplete="name" /></label>
              <div className="public-site-contact-pair"><label>Email<input name="email" type="email" maxLength={320} autoComplete="email" /></label><label>Phone<input name="phone" type="tel" maxLength={50} autoComplete="tel" /></label></div>
              <label>Message<textarea name="message" required minLength={10} maxLength={3000} rows={4} /></label>
              <label className="public-site-honeypot" aria-hidden="true">Leave this field empty<input name="website" tabIndex={-1} autoComplete="off" /></label>
              {contactError ? <p className="public-site-inline-error" role="alert">{contactError}</p> : null}
              {contactStatus ? <p className="public-site-inline-success" role="status">{contactStatus}</p> : null}
              <button className="public-site-button-primary" type="submit" disabled={contactBusy}>{contactBusy ? 'Sending…' : 'Send enquiry'} <ArrowRight size={16} /></button>
            </form>
          </section>
      </main>

      <footer className="public-site-footer"><a className="public-site-footer-brand" href="#home">{website.organization.name}</a><span>{[website.organization.address, website.organization.county, website.organization.country].filter(Boolean).join(' · ')}</span><span className="public-site-social-links">{content.facebookUrl ? <a href={content.facebookUrl} target="_blank" rel="noreferrer">Facebook</a> : null}{content.instagramUrl ? <a href={content.instagramUrl} target="_blank" rel="noreferrer">Instagram</a> : null}{content.linkedinUrl ? <a href={content.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a> : null}</span><span>© {new Date().getFullYear()} {website.organization.name}</span></footer>
    </div>
  );
}

function projectDraftWebsite(data: TenantWebsiteAdminResponse): PublicTenantWebsite {
  const content = data.website.draftContent;
  const branchIds = new Set(content.branchIds);
  const serviceIds = new Set(content.serviceIds);
  const providerIds = new Set(content.providerIds);
  const branches = data.branches.filter((branch) => branchIds.has(branch.id));
  const publicBranchIds = new Set(branches.map((branch) => branch.id));
  const services = data.services
    .filter((service) => serviceIds.has(service.id))
    .filter((service) => !service.branchId || publicBranchIds.has(service.branchId));
  const providers = data.providers
    .filter((provider) => providerIds.has(provider.id))
    .map(({ hasAvailability: _hasAvailability, ...provider }) => provider);
  return {
    slug: data.website.slug,
    organization: {
      name: data.tenant.name,
      type: data.tenant.type,
      description: content.description || data.tenant.profile?.description || '',
      address: data.tenant.profile?.address ?? null,
      town: data.tenant.profile?.subcounty ?? null,
      county: data.tenant.profile?.county ?? null,
      country: data.tenant.profile?.country ?? null,
      contactPhone: content.contactPhone || data.tenant.profile?.contactPhone || null,
      contactEmail: content.contactEmail || data.tenant.profile?.contactEmail || null,
    },
    content: {
      tagline: content.tagline,
      heroTitle: content.heroTitle,
      heroDescription: content.heroDescription,
      description: content.description,
      primaryColor: content.primaryColor,
      secondaryColor: content.secondaryColor,
      logoUrl: content.logoUrl,
      heroImageUrl: content.heroImageUrl,
      contactPhone: content.contactPhone,
      contactEmail: content.contactEmail,
      whatsapp: content.whatsapp,
      facebookUrl: content.facebookUrl,
      instagramUrl: content.instagramUrl,
      linkedinUrl: content.linkedinUrl,
      seoTitle: content.seoTitle,
      seoDescription: content.seoDescription,
      faqs: content.faqs,
    },
    branches,
    services,
    providers,
    bookingAvailable: data.tenant.setup?.status === 'LIVE' && services.length > 0 && providers.length > 0,
  };
}