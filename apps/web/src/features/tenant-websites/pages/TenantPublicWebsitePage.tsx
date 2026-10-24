import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowRight, Check, Clock3, FileText, Image, MapPin, Menu, Phone, Send, User, X } from 'lucide-react';
import { getAuthSession } from '../../auth/api/auth-session.js';
import {
  getMyWebsite,
  getPublicWebsite,
  getWebsiteSlots,
  submitWebsiteEnquiry,
  type PublicTenantWebsite,
  type TenantWebsiteAdminResponse,
  type WebsiteSlot,
} from '../api/tenant-websites.api.js';
import './TenantPublicWebsitePage.css';

export type PublicSection = 'home' | 'services' | 'locations' | 'team' | 'gallery' | 'about' | 'terms' | 'policy' | 'faqs' | 'contact' | 'booking';

interface TenantPublicWebsitePageProps {
  slug: string;
  preview?: boolean;
  activeSection?: PublicSection;
  onNavigate: (path: string) => void;
}

export function TenantPublicWebsitePage({ slug, preview = false, activeSection: activeSectionProp = 'home', onNavigate }: TenantPublicWebsitePageProps) {
  const [activeSection, setActiveSection] = useState<PublicSection>(activeSectionProp);
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
    if (activeSectionProp !== activeSection) {
      setActiveSection(activeSectionProp);
    }
  }, [activeSectionProp]);

  useEffect(() => {
    if (!website) return;
    const previousTitle = document.title;
    document.title = website.content.seoTitle || website.organization.name;
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const createdDescription = !description;
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.append(description);
    }
    const previousDescription = description.content;
    description.content = website.content.seoDescription || website.organization.description || website.organization.name;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement('link');
    const createdCanonical = !canonical.isConnected;
    const previousCanonical = canonical.href;
    canonical.rel = 'canonical';
    canonical.href = website.content.canonicalUrl || `${window.location.origin}/sites/${website.slug}`;
    if (createdCanonical) document.head.append(canonical);
    const socialMetadata = [
      ['og:title', website.content.openGraphTitle || website.content.seoTitle || website.organization.name],
      ['og:description', website.content.openGraphDescription || website.content.seoDescription || website.organization.description || website.organization.name],
      ['og:type', 'website'],
      ['og:url', canonical.href],
      ['og:image', website.content.socialShareImageUrl || website.content.heroImageUrl],
      ['twitter:card', website.content.socialShareImageUrl || website.content.heroImageUrl ? 'summary_large_image' : 'summary'],
      ['twitter:title', website.content.openGraphTitle || website.content.seoTitle || website.organization.name],
      ['twitter:description', website.content.openGraphDescription || website.content.seoDescription || website.organization.description || website.organization.name],
      ['twitter:image', website.content.socialShareImageUrl || website.content.heroImageUrl],
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
    let keywords = document.querySelector<HTMLMetaElement>('meta[name="keywords"]');
    const createdKeywords = !keywords;
    if (!keywords) {
      keywords = document.createElement('meta');
      keywords.name = 'keywords';
      document.head.append(keywords);
    }
    const previousKeywords = keywords.content;
    keywords.content = website.content.keywords.join(', ');
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const createdFavicon = !favicon && Boolean(website.content.faviconUrl);
    if (!favicon && website.content.faviconUrl) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.append(favicon);
    }
    const previousFavicon = favicon?.href ?? '';
    if (favicon && website.content.faviconUrl) favicon.href = website.content.faviconUrl;
    const structuredData = document.createElement('script');
    structuredData.type = 'application/ld+json';
    structuredData.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': website.content.structuredDataType,
      name: website.organization.name,
      description: website.content.description || website.organization.description,
      url: canonical.href,
      ...(website.content.socialShareImageUrl || website.content.heroImageUrl ? { image: website.content.socialShareImageUrl || website.content.heroImageUrl } : {}),
      ...(website.organization.contactPhone ? { telephone: website.organization.contactPhone } : {}),
      ...(website.organization.contactEmail ? { email: website.organization.contactEmail } : {}),
      ...(website.content.keywords.length ? { keywords: website.content.keywords.join(', ') } : {}),
      ...(website.content.emergencyPhone ? { contactPoint: { '@type': 'ContactPoint', telephone: website.content.emergencyPhone, contactType: 'emergency' } } : {}),
      ...(website.content.facebookUrl || website.content.instagramUrl || website.content.linkedinUrl ? { sameAs: [website.content.facebookUrl, website.content.instagramUrl, website.content.linkedinUrl].filter(Boolean) } : {}),
      ...(website.organization.address || website.organization.county || website.organization.country ? {
        address: {
          '@type': 'PostalAddress',
          ...(website.organization.address ? { streetAddress: website.organization.address } : {}),
          ...(website.organization.town ? { addressLocality: website.organization.town } : {}),
          ...(website.organization.county ? { addressRegion: website.organization.county } : {}),
          ...(website.organization.country ? { addressCountry: website.organization.country } : {}),
        },
      } : {}),
    });
    document.head.append(structuredData);
    return () => {
      document.title = previousTitle;
      if (createdDescription) description!.remove();
      else description!.content = previousDescription;
      if (createdCanonical) canonical.remove();
      else canonical.href = previousCanonical;
      if (createdKeywords) keywords!.remove();
      else keywords!.content = previousKeywords;
      if (createdFavicon) favicon?.remove();
      else if (favicon && previousFavicon) favicon.href = previousFavicon;
      else favicon?.removeAttribute('href');
      structuredData.remove();
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
        '/patient/appointments',
      );
      onNavigate('/login');
      return;
    }
    setBookingError(null);
    setBookingMessage('Continue in Patient Appointments to verify facility registration and complete the KSh 100 M-Pesa deposit.');
    onNavigate('/patient/appointments');
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
          <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('home'); onNavigate(`/sites/${slug}`); }}>Home</a>
          {website.services?.length ? <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('services'); onNavigate(`/sites/${slug}/services`); }}>Services</a> : null}
          {website.branches?.length ? <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('locations'); onNavigate(`/sites/${slug}/locations`); }}>Locations</a> : null}
          {website.providers?.length ? <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('team'); onNavigate(`/sites/${slug}/team`); }}>Care team</a> : null}
          {content.gallery?.length ? <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('gallery'); onNavigate(`/sites/${slug}/gallery`); }}>Gallery</a> : null}
          <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('about'); onNavigate(`/sites/${slug}/about`); }}>About</a>
          {content.faqs?.length ? <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('faqs'); onNavigate(`/sites/${slug}/faqs`); }}>FAQs</a> : null}
          <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('terms'); onNavigate(`/sites/${slug}/terms`); }}>Terms</a>
          <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('policy'); onNavigate(`/sites/${slug}/policy`); }}>Policy</a>
          <a onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('contact'); onNavigate(`/sites/${slug}/contact`); }}>Contact</a>
          {website.bookingAvailable ? <a className="public-site-nav-cta" onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); setActiveSection('booking'); onNavigate(`/sites/${slug}/booking`); }}>Book a visit <ArrowRight size={15} /></a> : null}
          <a className="public-site-nav-account" onClick={(event) => { event.preventDefault(); setMobileMenuOpen(false); onNavigate('/login'); }}><User size={15} /> Sign in</a>
        </nav>
      </header>

      <main>
        {activeSection === 'home' ? (
          <>
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
          </>
        ) : null}

        {activeSection === 'home' && website.organization.description ? (
          <section className="public-site-intro">
            <div className="public-site-section-kicker">ABOUT THE ORGANIZATION</div>
            <h2>Care shaped around your needs.</h2>
            <p>{website.organization.description}</p>
          </section>
        ) : null}

        {activeSection === 'services' && website.services.length ? (
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

        {activeSection === 'locations' && website.branches.length ? (
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

        {activeSection === 'team' && website.providers.length ? (
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

        {activeSection === 'gallery' && content.gallery.length ? (
          <section className="public-site-section public-site-gallery" id="gallery">
            <div className="public-site-section-heading"><div><p className="public-site-section-kicker">GALLERY</p><h2>Our gallery</h2></div></div>
            <div className="public-site-gallery-grid">
              {content.gallery.map((image) => (
                <figure className="public-site-gallery-item" key={image.id}>
                  {image.url ? <img className="public-site-gallery-image" src={image.url} alt={image.title || 'Gallery image'} loading="lazy" /> : null}
                  {image.title ? <figcaption>{image.title}</figcaption> : null}
                  {image.description ? <p className="public-site-gallery-caption">{image.description}</p> : null}
                </figure>
              ))}
            </div>
          </section>
        ) : null}

        {activeSection === 'about' ? (
          <section className="public-site-section public-site-about" id="about">
            <div className="public-site-section-heading"><div><p className="public-site-section-kicker">ABOUT US</p><h2>{content.about?.title || 'About us'}</h2></div></div>
            {content.about?.imageUrl ? <img className="public-site-about-image" src={content.about.imageUrl} alt={content.about.title || 'About'} loading="lazy" /> : null}
            <div className="public-site-about-body">
              <p className="public-site-about-description">{content.about?.description || 'We are dedicated to providing quality healthcare services to our community.'}</p>
            </div>
          </section>
        ) : null}

        {activeSection === 'booking' && website.bookingAvailable ? (
          <section className="public-site-booking" id="booking">
            <div className="public-site-booking-copy"><p className="public-site-section-kicker">APPOINTMENT REQUEST</p><h2>Find a time that works for you.</h2><p>Availability is provided by the organization’s live scheduling system. Your request is confirmed only when the server accepts it.</p></div>
            <div className="public-site-booking-form">
              <label>Service<select value={selectedServiceId} onChange={(event) => setSelectedServiceId(event.target.value)}><option value="">Choose a service</option>{website.services.map((service) => <option value={service.id} key={service.id}>{service.name}{service.durationMin ? ` · ${service.durationMin} min` : ''}</option>)}</select></label>
              {website.branches?.length ? <label>Location<select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}><option value="">All listed locations</option>{website.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
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

        {activeSection === 'faqs' && content.faqs.length ? (
          <section className="public-site-section public-site-faqs" id="faqs"><div className="public-site-section-heading"><div><p className="public-site-section-kicker">GOOD TO KNOW</p><h2>Frequently asked questions</h2></div></div>{content.faqs.map((faq, index) => <details key={`${faq.question}-${index}`}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</section>
        ) : null}

        {activeSection === 'terms' ? (
          <section className="public-site-section public-site-terms" id="terms">
            <div className="public-site-section-heading"><div><p className="public-site-section-kicker">TERMS OF SERVICE</p><h2>Terms of Service</h2></div></div>
            <div className="public-site-legal-body">
              {content.terms ? (
                <div className="public-site-legal-body">
                  {content.terms.split(/\n\n+/).map((block, i) => (
                    <p key={i}>{block}</p>
                  ))}
                </div>
              ) : (
                <>
                  <p>These terms govern access to the website and services offered by {website.organization.name}. By using this website, you agree to these terms.</p>
                  <p>You are responsible for providing accurate information and keeping your account credentials secure.</p>
                  <p>The website provides software tools and communication services, not medical advice, diagnosis, or treatment. For emergencies, contact local emergency services or the organization directly.</p>
                  <p>For questions about these terms, contact {website.organization.name} directly.</p>
                </>
              )}
            </div>
          </section>
        ) : null}

        {activeSection === 'policy' ? (
          <section className="public-site-section public-site-policy" id="policy">
            <div className="public-site-section-heading"><div><p className="public-site-section-kicker">PRIVACY POLICY</p><h2>Privacy Policy</h2></div></div>
            <div className="public-site-legal-body">
              {content.policy ? (
                <div className="public-site-legal-body">
                  {content.policy.split(/\n\n+/).map((block, i) => (
                    <p key={i}>{block}</p>
                  ))}
                </div>
              ) : (
                <>
                  <p>This privacy policy explains how information is handled when people use services offered by {website.organization.name}.</p>
                  <p>We collect information you provide directly, such as your name, email, and phone number when you submit an enquiry or request an appointment.</p>
                  <p>Information is used to respond to your requests, schedule appointments, and provide services. We do not sell your personal information.</p>
                  <p>You may contact {website.organization.name} to access, correct, or request deletion of your information.</p>
                </>
              )}
            </div>
          </section>
        ) : null}

        {activeSection === 'contact' ? (
          <section className="public-site-contact" id="contact"><div><p className="public-site-section-kicker">GET IN TOUCH</p><h2>How can we help?</h2><p>Send a message to the organization. Responses are handled by the organization directly.</p>{website.organization.contactPhone ? <a href={`tel:${website.organization.contactPhone}`}><Phone size={16} /> {website.organization.contactPhone}</a> : null}{website.organization.contactEmail ? <a href={`mailto:${website.organization.contactEmail}`}><Send size={16} /> {website.organization.contactEmail}</a> : null}{website.content.whatsapp.replace(/\D/g, '') ? <a href={`https://wa.me/${website.content.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">Message us on WhatsApp</a> : null}{website.content.emergencyPhone ? <a className="public-site-emergency-link" href={`tel:${website.content.emergencyPhone}`}><Phone size={16} /> Emergency: {website.content.emergencyPhone}</a> : null}{website.content.emergencyMessage ? <p className="public-site-emergency-message">{website.content.emergencyMessage}</p> : null}{website.content.googleBusinessProfileUrl ? <a href={website.content.googleBusinessProfileUrl} target="_blank" rel="noreferrer">View our Google Business Profile</a> : null}</div>
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
        ) : null}
      </main>

      <footer className="public-site-footer"><a className="public-site-footer-brand" href="#home">{website.organization.name}</a><span>{[website.organization.address, website.organization.county, website.organization.country].filter(Boolean).join(' · ')}</span><span className="public-site-social-links">{content.facebookUrl ? <a href={content.facebookUrl} target="_blank" rel="noreferrer">Facebook</a> : null}{content.instagramUrl ? <a href={content.instagramUrl} target="_blank" rel="noreferrer">Instagram</a> : null}{content.linkedinUrl ? <a href={content.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a> : null}</span><span>© {new Date().getFullYear()} {website.organization.name}</span></footer>
    </div>
  );
}

function projectDraftWebsite(data: TenantWebsiteAdminResponse): PublicTenantWebsite {
  const content = data.website.draftContent;
  const {
    branchIds: _branchIds,
    serviceIds: _serviceIds,
    providerIds: _providerIds,
    ...publicContent
  } = content;
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
    content: publicContent,
    branches,
    services,
    providers,
    bookingAvailable: data.tenant.setup?.status === 'LIVE' && services.length > 0 && providers.length > 0,
  };
}