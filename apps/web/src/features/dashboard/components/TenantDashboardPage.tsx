import { useEffect, useState } from 'react';
import type { DashboardMembership } from '../types.js';
import { getTenantSetup, requestTenantActivation } from '../api/tenant-setup.api.js';
import type { TenantSetupRequirement, TenantSetupResponse } from '../types/tenant-setup.types.js';
import { getMyWebsiteStatus, type TenantWebsiteStatus } from '../../tenant-websites/api/tenant-websites.api.js';
import { requirementRoutes } from '../requirement-routes.js';

interface TenantDashboardPageProps {
  membership: DashboardMembership;
  onNavigate?: (path: string) => void;
  currentPath?: string;
}

const dashboardNames: Record<string, string> = {
  HOSPITAL: 'Hospital',
  CLINIC: 'Clinic',
  SPECIALIST_PRACTICE: 'Specialist Practice',
  MEDICAL_CENTER: 'Medical Center',
  DIAGNOSTIC_CENTER: 'Diagnostic Center',
  LABORATORY: 'Laboratory',
  RADIOLOGY_CENTER: 'Radiology Center',
  PHARMACY: 'Pharmacy',
  DENTAL_CLINIC: 'Dental Clinic',
  OPTICAL_CENTER: 'Optical Center',
  MATERNITY_CENTER: 'Maternity Center',
  REHABILITATION_CENTER: 'Rehabilitation',
  HOME_HEALTH_PROVIDER: 'Home Health',
  AMBULANCE_PROVIDER: 'Ambulance',
  HEALTHCARE_NETWORK: 'Healthcare Network',
  CORPORATE_HEALTH_PROVIDER: 'Corporate Health',
  INSURER: 'Insurer',
  EXTERNAL_PROVIDER: 'External Provider',
  OTHER_HEALTHCARE_PROVIDER: 'Healthcare Provider',
};

function RequirementRow({
  requirement,
  onNavigate,
}: {
  requirement: TenantSetupRequirement;
  onNavigate?: (path: string) => void;
}) {
  const route = requirement.ctaRoute ?? requirementRoutes[requirement.key];

  return (
    <div className="tenant-readiness-row">
      <div className="tenant-readiness-status" aria-hidden="true">
        {requirement.complete ? '✓' : '○'}
      </div>

      <div className="tenant-readiness-content">
        <div className="tenant-readiness-title">
          <strong>{requirement.label}</strong>
          {requirement.required && <span className="tenant-readiness-required">Required</span>}
        </div>

        <span className="tenant-readiness-weight">
          {requirement.status.replaceAll('_', ' ')} · {requirement.progress}%
        </span>
        {!requirement.complete ? (
          <span className="tenant-readiness-reason">
            Missing: {requirement.missing.join(', ') || requirement.reason}
          </span>
        ) : null}
      </div>

      {!requirement.complete && route && onNavigate && (
        <button type="button" className="tenant-readiness-action" onClick={() => onNavigate(route)}>
          {requirement.ctaLabel}
        </button>
      )}
    </div>
  );
}

function getStatusLabel(status: TenantSetupResponse['setup']['status']) {
  switch (status) {
    case 'LIVE':
      return 'Live';
    case 'READY':
      return 'Ready for activation review';
    case 'IN_PROGRESS':
      return 'Setup in progress';
    case 'BLOCKED':
      return 'Setup blocked';
    case 'SUSPENDED':
      return 'Suspended';
    default:
      return 'Setup not started';
  }
}

export function TenantDashboardPage({
  membership,
  onNavigate,
  currentPath = '/dashboard',
}: TenantDashboardPageProps) {
  const [setup, setSetup] = useState<TenantSetupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activationSubmitting, setActivationSubmitting] = useState(false);
  const [activationMessage, setActivationMessage] = useState<string | null>(null);
  const [websiteStatus, setWebsiteStatus] = useState<TenantWebsiteStatus | null>(null);
  const [websiteStatusLoaded, setWebsiteStatusLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSetup(): Promise<void> {
      try {
        const result = await getTenantSetup();

        if (!cancelled) {
          setSetup(result);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to load organization readiness.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSetup();
    void getMyWebsiteStatus().then((status) => {
      if (!cancelled) {
        setWebsiteStatus(status);
        setWebsiteStatusLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) setWebsiteStatusLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const tenantType = membership.tenant.type;
  const dashboardName = dashboardNames[tenantType] ?? 'Healthcare Organization';

  if (loading) {
    return (
      <main className="tenant-dashboard-shell">
        <section className="tenant-dashboard-loading">
          <p className="dashboard-eyebrow">REVALTRIX</p>
          <h1>Loading organization setup...</h1>
          <p>Checking your organization readiness.</p>
        </section>
      </main>
    );
  }

  if (error || !setup) {
    return (
      <main className="tenant-dashboard-shell">
        <section className="tenant-dashboard-error">
          <p className="dashboard-eyebrow">ORGANIZATION SETUP</p>
          <h1>Unable to load setup</h1>
          <p>{error ?? 'Organization readiness is unavailable.'}</p>
          <button
            type="button"
            className="tenant-primary-action"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  const incompleteRequired = setup.requirements.filter((item) => item.required && !item.complete);

  async function handleRequestActivation(): Promise<void> {
    setActivationSubmitting(true);
    setActivationMessage(null);
    setError(null);

    try {
      const result = await requestTenantActivation();
      setActivationMessage(result.message);
      setSetup(await getTenantSetup());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to submit the facility activation request.',
      );
    } finally {
      setActivationSubmitting(false);
    }
  }

  return (
    <main className="tenant-dashboard-shell">
      <header className="tenant-dashboard-header">
        <div>
          <p className="dashboard-eyebrow">REVALTRIX HEALTHCARE PLATFORM</p>
          <h1>{setup.tenant.name}</h1>
          <p>{dashboardName} organization workspace</p>
        </div>

        <div className="tenant-dashboard-user">
          <strong>{membership.roles[0]?.name ?? 'User'}</strong>
          {membership.branch && <span>{membership.branch.name}</span>}
          {membership.department && <span>{membership.department.name}</span>}
        </div>
      </header>

      <section className="tenant-readiness-hero">
        <div>
          <p className="dashboard-eyebrow">ORGANIZATION READINESS</p>
          <h2>
            {setup.setup.status === 'LIVE'
              ? 'Your organization is live'
              : 'Prepare your organization for live operations'}
          </h2>
          <p>
            Configure the required organization, operational and financial settings before enabling
            live healthcare workflows.
          </p>
        </div>

        <div className="tenant-readiness-score">
          <strong>{setup.setup.readinessPercent}%</strong>
          <span>Ready</span>
        </div>
      </section>

      <section className="tenant-readiness-progress">
        <div className="tenant-readiness-progress-track">
          <div
            className="tenant-readiness-progress-value"
            style={{
              width: `${setup.setup.readinessPercent}%`,
            }}
          />
        </div>

        <div className="tenant-readiness-summary">
          <span>
            {setup.summary.completed} of {setup.summary.total} configuration items complete
          </span>
          <strong>{getStatusLabel(setup.setup.status)}</strong>
        </div>
      </section>

      {setup.setup.status !== 'LIVE' && (
        <section className="tenant-readiness-callout">
          <div>
            <p className="dashboard-eyebrow">NEXT STEP</p>
            <h3>
              {setup.summary.ready
                ? 'Your organization is ready for Go Live.'
                : `${incompleteRequired.length} required configuration ${
                    incompleteRequired.length === 1 ? 'item remains' : 'items remain'
                  }.`}
            </h3>
            <p>
              {setup.summary.ready
                ? 'Review the configuration and complete the Go Live process when you are ready.'
                : 'Complete the required items below before live patient operations can be enabled.'}
            </p>
          </div>

          {setup.summary.ready && (
            <button
              type="button"
              className="tenant-primary-action"
              disabled={activationSubmitting}
              onClick={() => void handleRequestActivation()}
            >
              {activationSubmitting ? 'Submitting…' : 'Request activation'}
            </button>
          )}
        </section>
      )}

      {activationMessage ? (
        <section className="tenant-readiness-callout" role="status">
          <p>{activationMessage}</p>
        </section>
      ) : null}

      <section className="tenant-dashboard-content">
        <div className="tenant-dashboard-main">
          <div className="dashboard-card">
            <div className="card-heading">
              <div>
                <p className="dashboard-card-label">SETUP CHECKLIST</p>
                <h2>Organization configuration</h2>
              </div>
              <span>
                {setup.summary.requiredCompleted}/{setup.summary.required} required
              </span>
            </div>

            <div className="tenant-readiness-list">
              {setup.requirements.map((requirement) => (
                <RequirementRow
                  key={requirement.key}
                  requirement={requirement}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        </div>

        <aside className="tenant-dashboard-sidebar">
          <div className="dashboard-card">
            <p className="dashboard-card-label">ORGANIZATION</p>
            <h2>{dashboardName}</h2>
            <dl className="tenant-summary-list">
              <div>
                <dt>Organization</dt>
                <dd>{setup.tenant.name}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{dashboardName}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{getStatusLabel(setup.setup.status)}</dd>
              </div>
            </dl>
          </div>

          <div className="dashboard-card">
            <p className="dashboard-card-label">PUBLIC WEBSITE</p>
            <h2>{!websiteStatusLoaded ? 'Loading' : !websiteStatus ? 'Unavailable' : websiteStatus.status === 'PUBLISHED' ? 'Published' : websiteStatus.status === 'UNPUBLISHED' ? 'Unpublished' : 'Draft'}</h2>
            <p>{websiteStatus ? `/sites/${websiteStatus.slug}` : websiteStatusLoaded ? 'Website status could not be loaded for this account.' : 'Loading website status.'}</p>
            {websiteStatus?.publicUrl ? <a href={websiteStatus.publicUrl} target="_blank" rel="noreferrer">Open website</a> : null}
            <button type="button" onClick={() => onNavigate?.('/tenant/website')}>Manage website</button>
          </div>

          <div className="dashboard-card">
            <p className="dashboard-card-label">WORKSPACE</p>
            <h2>Core areas</h2>
            <div className="tenant-workspace-links">
              <button type="button" onClick={() => onNavigate?.('/tenant/organization')}>
                Organization
              </button>
              <button type="button" onClick={() => onNavigate?.('/tenant/branches')}>
                Branches
              </button>
              <button type="button" onClick={() => onNavigate?.('/tenant/departments')}>
                Departments
              </button>
              <button type="button" onClick={() => onNavigate?.('/tenant/services')}>
                Services
              </button>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
