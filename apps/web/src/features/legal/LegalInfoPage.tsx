import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import './LegalInfoPage.css';

type LegalDocument = 'terms' | 'privacy';

const documents = {
  terms: {
    title: 'Terms of Service',
    intro: 'These terms govern access to the Revaltrix platform by healthcare organizations, their personnel, and people using organization services.',
    sections: [
      ['1. Accounts and access', 'You must provide accurate registration details and keep account credentials secure. Organization administrators are responsible for assigning appropriate access, reviewing membership changes, and promptly reporting suspected unauthorized access. Each user is responsible for activity performed through their account.'],
      ['2. Organization responsibilities', 'Organizations control their profiles, services, locations, schedules, appointment rules, and the information they submit. They are responsible for keeping those records accurate, having authority to publish them, and meeting the laws and professional obligations that apply to their services.'],
      ['3. Healthcare services', 'Revaltrix provides software and communication tools, not medical advice, diagnosis, treatment, emergency dispatch, or a substitute for a licensed professional. An appointment request is not confirmed care until the organization confirms it. For emergencies, contact local emergency services or the organization directly.'],
      ['4. Acceptable use', 'Do not use the platform to violate another person’s rights, submit false or unlawful information, interfere with platform security or availability, or access information beyond your authorization. Do not upload malicious code or use the platform to send unlawful or unsolicited communications.'],
      ['5. Information and content', 'You retain rights to content you submit. You authorize Revaltrix to host, process, display, and transmit that content as needed to operate the platform and the features you choose. You must not submit content unless you have the rights and permissions required to do so.'],
      ['6. Availability and third-party services', 'The platform may change, be temporarily unavailable, or depend on third-party services. Integrations, payment methods, messages, and appointment availability are subject to the relevant provider and organization configuration. We do not guarantee uninterrupted service or third-party performance.'],
      ['7. Suspension and termination', 'Access may be restricted when reasonably necessary to protect users, comply with law, address security concerns, or enforce these terms. Organizations should arrange export or retention of records they are responsible for before ending their use of the platform, subject to applicable law and available product features.'],
      ['8. Disclaimers and liability', 'To the extent permitted by law, the platform is provided on an “as available” basis. Nothing in these terms excludes liability that cannot legally be excluded. Each organization remains responsible for its professional services and decisions made using platform information.'],
      ['9. Changes and governing requirements', 'These terms may be updated as the platform changes or legal requirements evolve. The version presented at acceptance is recorded for the accepting administrator. Mandatory consumer and healthcare protections continue to apply.'],
      ['10. Questions', 'For questions about these terms or your organization’s use of Revaltrix, contact your organization administrator or use the support contact provided to your organization.'],
    ] as const,
  },
  privacy: {
    title: 'Privacy Policy',
    intro: 'This policy explains how information is handled when people use Revaltrix and services offered by organizations on the platform.',
    sections: [
      ['1. Roles and scope', 'Organizations decide why and how they use information about their patients, staff, and operations. They may act as the responsible organization for that information, while Revaltrix provides the platform to support their instructions. Revaltrix may separately process account, security, and service information to operate and protect the platform.'],
      ['2. Information handled', 'Depending on the features an organization uses, information may include account and contact details; organization, branch, staff, and service records; appointment and communication details; health information entered by an organization or patient; uploaded compliance documents; and technical, audit, and security logs.'],
      ['3. How information is used', 'Information is used to provide account access, organization websites, registration, appointment and communication workflows, recordkeeping, customer support, platform security, and required operational or legal processes. Organizations control their public website content and the services they offer.'],
      ['4. Sharing and access', 'Information is made available to authorized organization personnel according to their access permissions and to service providers needed to operate the platform. Information may also be disclosed where required by law or to protect people, rights, and platform security. Revaltrix does not sell personal information.'],
      ['5. Retention and deletion', 'Information is retained for as long as needed for the purposes above, the organization’s instructions, and applicable legal or recordkeeping requirements. Retention periods can vary by record type and jurisdiction. Requests about patient or organization records should first be directed to the responsible organization.'],
      ['6. Security', 'Revaltrix uses access controls, audit records, and technical safeguards intended to protect information. No online service can guarantee absolute security. Users and organizations must protect credentials, use appropriate permissions, and report suspected incidents promptly.'],
      ['7. Your choices and rights', 'Privacy rights and request procedures depend on your location and the organization responsible for the information. Contact the relevant organization to access, correct, or request deletion of records it controls. For platform account questions, use the support contact provided to your organization.'],
      ['8. Children and sensitive information', 'Organizations are responsible for ensuring they have the authority and permissions required to submit information, including information about children or health information. Access to such information should be limited to authorized users and used only for appropriate care and operational purposes.'],
      ['9. International processing and updates', 'Platform service providers may process information in locations that differ from yours, subject to applicable safeguards. This policy may be updated when platform features or legal requirements change; the current version is published on this page.'],
      ['10. Privacy questions', 'For questions about information held by a healthcare organization, contact that organization. For platform privacy questions, contact Revaltrix through the support contact provided to your organization.'],
    ] as const,
  },
} satisfies Record<LegalDocument, { title: string; intro: string; sections: ReadonlyArray<readonly [string, string]> }>;

export function LegalInfoPage({ document, onNavigate }: { document: LegalDocument; onNavigate: (path: string) => void }) {
  const page = documents[document];

  useEffect(() => {
    const previousTitle = window.document.title;
    window.document.title = `${page.title} | Revaltrix`;
    return () => { window.document.title = previousTitle; };
  }, [page.title]);

  return (
    <main className="legal-info-page">
      <header className="legal-info-header">
        <a href="/" onClick={(event) => { event.preventDefault(); onNavigate('/'); }} className="legal-info-brand">REVALTRIX</a>
        <nav aria-label="Legal pages">
          <a href="/terms" aria-current={document === 'terms' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onNavigate('/terms'); }}>Terms</a>
          <a href="/privacy" aria-current={document === 'privacy' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onNavigate('/privacy'); }}>Privacy Policy</a>
        </nav>
      </header>
      <article className="legal-info-content">
        <button type="button" className="legal-info-back" onClick={() => onNavigate('/')}><ArrowLeft size={16} /> Back</button>
        <p className="legal-info-eyebrow">REVALTRIX PLATFORM</p>
        <h1>{page.title}</h1>
        <p className="legal-info-intro">{page.intro}</p>
        {page.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}
        <footer><a href="/terms" onClick={(event) => { event.preventDefault(); onNavigate('/terms'); }}>Terms of Service</a><a href="/privacy" onClick={(event) => { event.preventDefault(); onNavigate('/privacy'); }}>Privacy Policy</a></footer>
      </article>
    </main>
  );
}