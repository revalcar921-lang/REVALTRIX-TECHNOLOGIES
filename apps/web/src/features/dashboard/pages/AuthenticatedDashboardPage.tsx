import { useEffect, useState } from 'react';
import { getDashboard } from '../api/dashboard.api.js';
import { getTenantFeatureManagementAccess, getTenantFeatures } from '../api/tenant-features.api.js';
import type { TenantFeature, TenantFeatureState } from '../api/tenant-features.api.js';
import {
  getTenantDashboardRoute,
  isLegacyTenantDashboardRoute,
  isTenantDashboardRoute,
} from '../tenant-dashboard-routes.js';
import { isDashboardPathAvailable } from '../dashboard-navigation.js';
import type { DashboardMembership, DashboardResponse } from '../types.js';
import { TenantDashboardPage } from '../components/TenantDashboardPage.js';
import { TenantDashboardShell } from '../components/TenantDashboardShell.js';
import { OrganizationPage } from '../../organization/components/OrganizationPage.js';
import { HospitalDashboardPage } from '../components/HospitalDashboardPage.js';
import { BranchesPage } from '../../branches/components/BranchesPage.js';
import { DepartmentsPage } from '../../departments/components/DepartmentsPage.js';
import { StaffPage } from '../../staff/components/StaffPage.js';
import { getMyStaffProfile } from '../../staff/api/staff.api.js';
import { ServicesPage } from '../../services/components/ServicesPage.js';
import { PatientsPage } from '../../patients/components/PatientsPage.js';
import { EncountersPage } from '../../encounters/components/EncountersPage.js';
import { AppointmentsPage } from '../../appointments/components/AppointmentsPage.js';
import { QueuePage } from '../../queues/components/QueuePage.js';
import { NotificationsPage } from '../../notifications/pages/NotificationsPage.js';
import { clearAuthSession } from '../../auth/api/auth-session.js';
import { ShopPage } from '../../shop/components/ShopPage.js';
import { TenantFeatureAccessPage } from './TenantFeatureAccessPage.js';
import { TenantWebsiteEditorPage } from '../../tenant-websites/pages/TenantWebsiteEditorPage.js';
import { TenantSetupConfigPage } from './TenantSetupConfigPage.js';
import { ProvidersPage } from '../../providers/components/ProvidersPage.js';
import { getOwnershipReviewAccess } from '../api/tenant-ownership-review.api.js';

interface AuthenticatedDashboardPageProps {
  requestedPath: string;
  onNavigate: (path: string) => void;
}

export function AuthenticatedDashboardPage({
  requestedPath,
  onNavigate,
}: AuthenticatedDashboardPageProps) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [membership, setMembership] = useState<DashboardMembership | null>(null);
  const [tenantFeatures, setTenantFeatures] = useState<TenantFeatureState[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [canReviewOwnership, setCanReviewOwnership] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        if (requestedPath === '/dashboard') {
          const staffResult = await getMyStaffProfile();
          if (staffResult.profile) {
            onNavigate('/staff/dashboard');
            return;
          }
        }

        const [result, featureStates, canManageFeatures, ownershipReviewAccess] = await Promise.all([
          getDashboard(),
          getTenantFeatures(),
          getTenantFeatureManagementAccess(),
          getOwnershipReviewAccess(),
        ]);

        if (cancelled) {
          return;
        }

        setDashboard(result);
        setTenantFeatures(featureStates);
        setIsPlatformAdmin(canManageFeatures);
        setCanReviewOwnership(ownershipReviewAccess);

        if (!result.membership || !result.tenant) {
          setError(
            'Your account has no active organization membership. Sign in again or contact your organization administrator.',
          );
          return;
        }

        const tenantMembership = {
          ...result.membership,
          tenant: result.tenant,
        };

        if (!tenantMembership) {
          setError('No active organization membership was found.');
          return;
        }

        setMembership(tenantMembership);

        const authoritativeRoute = getTenantDashboardRoute(tenantMembership.tenant.type);

        if (requestedPath === '/dashboard' || !isTenantDashboardRoute(requestedPath)) {
          onNavigate(authoritativeRoute);
        }
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        const errorMessage =
          requestError instanceof Error ? requestError.message : 'Unable to load your dashboard.';

        const authenticationError =
          /401|unauthorized|invalid access token|authentication required|session is no longer active|expired token/i.test(
            errorMessage,
          );

        if (authenticationError) {
          clearAuthSession();
          setError('Your session is invalid or has expired. Please sign in again.');
          setLoading(false);
          return;
        }

        setError(errorMessage);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [requestedPath, onNavigate]);

  function handleLogout(): void {
    clearAuthSession();
    onNavigate('/login');
  }

  if (loading) {
    return (
      <main className="registration-loading">
        <p>Loading your Revaltrix organization...</p>
      </main>
    );
  }

  if (error || !dashboard || !membership) {
    const authenticationError =
      /session is invalid|sign in again|401|unauthorized|invalid access token|authentication required|session is no longer active|expired token/i.test(
        error ?? '',
      );

    return (
      <main className="registration-loading">
        <h1>Dashboard unavailable</h1>
        <p>{error ?? 'Unable to resolve your organization dashboard.'}</p>
        {authenticationError ? (
          <button type="button" onClick={() => onNavigate('/login')}>
            Go to login
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setDashboard(null);
                setMembership(null);
                setLoading(true);
                onNavigate(requestedPath);
              }}
            >
              Return to dashboard
            </button>
            <button type="button" onClick={() => onNavigate('/login')}>
              Go to login
            </button>
          </>
        )}
      </main>
    );
  }

  function renderTenantContent(resolvedMembership: DashboardMembership) {
    const tenantType = resolvedMembership.tenant.type;
    const legacyDashboardRoute = isLegacyTenantDashboardRoute(tenantType, requestedPath);
    const enabledFeatures = new Set<TenantFeature>(
      tenantFeatures.filter((feature) => feature.enabled).map((feature) => feature.feature),
    );

    if (
      !isDashboardPathAvailable(tenantType, requestedPath, enabledFeatures, isPlatformAdmin, canReviewOwnership) &&
      !legacyDashboardRoute
    ) {
      return (
        <section className="tenant-dashboard-error" role="status">
          <p className="dashboard-eyebrow">MODULE UNAVAILABLE</p>
          <h1>This module is not available for your tenant type.</h1>
          <p>
            The selected workspace module is not enabled for this organization. Use the sidebar to
            open an available module.
          </p>
          <button
            type="button"
            className="tenant-primary-action"
            onClick={() => onNavigate('/tenant/dashboard')}
          >
            Return to dashboard
          </button>
        </section>
      );
    }

    if (requestedPath === '/tenant/dashboard') {
      return (
        <TenantDashboardPage
          membership={resolvedMembership}
          currentPath={requestedPath}
          onNavigate={onNavigate}
        />
      );
    }

    if (requestedPath === '/tenant/organization') {
      return <OrganizationPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/branches') {
      return <BranchesPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/departments') {
      return <DepartmentsPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/staff') {
      return <StaffPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/providers') {
      return <ProvidersPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/services') {
      return <ServicesPage />;
    }

    if (requestedPath === '/tenant/website') {
      return <TenantWebsiteEditorPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/setup') {
      return <TenantSetupConfigPage />;
    }

    if (requestedPath === '/tenant/patients') {
      return <PatientsPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/encounters') {
      return <EncountersPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/appointments') {
      return <AppointmentsPage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/queue') {
      return <QueuePage onNavigate={onNavigate} />;
    }

    if (requestedPath === '/tenant/shop') {
      return <ShopPage />;
    }

    if (requestedPath === '/tenant/features' && isPlatformAdmin) {
      return (
        <TenantFeatureAccessPage
          tenantId={resolvedMembership.tenant.id}
          onFeaturesChanged={setTenantFeatures}
        />
      );
    }

    if (requestedPath === '/tenant/notifications') {
      return <NotificationsPage onNavigate={onNavigate} />;
    }

    if (tenantType === 'HOSPITAL' && requestedPath === '/tenant/hospital') {
      return <HospitalDashboardPage onNavigate={onNavigate} />;
    }

    return (
      <TenantDashboardPage
        membership={resolvedMembership}
        currentPath={requestedPath}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <TenantDashboardShell
      membership={membership}
      currentPath={requestedPath}
      enabledFeatures={
        new Set<TenantFeature>(
          tenantFeatures.filter((feature) => feature.enabled).map((feature) => feature.feature),
        )
      }
      isPlatformAdmin={isPlatformAdmin}
      canReviewOwnership={canReviewOwnership}
      onNavigate={onNavigate}
      onLogout={handleLogout}
    >
      {renderTenantContent(membership)}
    </TenantDashboardShell>
  );
}
