import type { ReactNode } from 'react';
import type { DashboardMembership } from '../types.js';
import type { TenantFeature } from '../api/tenant-features.api.js';
import { getDashboardNavigation } from '../dashboard-navigation.js';

interface TenantDashboardShellProps {
  membership: DashboardMembership;
  currentPath: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: ReactNode;
  enabledFeatures?: ReadonlySet<TenantFeature>;
  isPlatformAdmin?: boolean;
  canReviewOwnership?: boolean;
}

const tenantTypeLabels: Record<string, string> = {
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
  HOME_HEALTH_PROVIDER: 'Home Health Provider',
  AMBULANCE_PROVIDER: 'Ambulance Provider',
  HEALTHCARE_NETWORK: 'Healthcare Network',
  CORPORATE_HEALTH_PROVIDER: 'Corporate Health Provider',
  INSURER: 'Insurer',
  EXTERNAL_PROVIDER: 'External Provider',
  OTHER_HEALTHCARE_PROVIDER: 'Healthcare Provider',
};

export function TenantDashboardShell({
  membership,
  currentPath,
  onNavigate,
  onLogout,
  children,
  enabledFeatures,
  isPlatformAdmin,
  canReviewOwnership,
}: TenantDashboardShellProps) {
  const navigation = getDashboardNavigation(
    membership.tenant.type,
    enabledFeatures,
    isPlatformAdmin,
    canReviewOwnership,
  );
  const tenantType = tenantTypeLabels[membership.tenant.type] ?? 'Healthcare Organization';

  return (
    <div className="tenant-app-shell">
      <aside className="tenant-sidebar">
        <div className="tenant-sidebar-brand">
          <div className="tenant-brand-mark">R</div>
          <div>
            <strong>REVALTRIX</strong>
            <span>Healthcare Platform</span>
          </div>
        </div>

        <div className="tenant-sidebar-organization">
          <strong>{membership.tenant.name}</strong>
          <span>{tenantType}</span>
        </div>

        <nav className="tenant-sidebar-navigation" aria-label="Organization navigation">
          {navigation.map((group) => (
            <div className="tenant-nav-group" key={group.section}>
              <p>{group.label}</p>

              {group.items.map((item) => {
                const active =
                  currentPath === item.path ||
                  (item.path !== '/dashboard' && currentPath.startsWith(`${item.path}/`));

                return (
                  <button
                    type="button"
                    key={item.key}
                    className={`tenant-nav-item${active ? ' active' : ''}`}
                    onClick={() => onNavigate(item.path)}
                  >
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="tenant-sidebar-footer">
          <div className="tenant-user-summary">
            <strong>{membership.roles[0]?.name ?? 'User'}</strong>
            {membership.branch && <span>{membership.branch.name}</span>}
            {membership.department && <span>{membership.department.name}</span>}
          </div>

          <button type="button" className="tenant-logout-button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="tenant-app-main">
        <header className="tenant-topbar">
          <div>
            <span className="tenant-topbar-label">Organization workspace</span>
            <strong>{membership.tenant.name}</strong>
          </div>

          <div className="tenant-topbar-actions">
            <button
              type="button"
              className="tenant-topbar-button"
              onClick={() => onNavigate('/tenant/notifications')}
            >
              Notifications
            </button>

            <button
              type="button"
              className="tenant-topbar-button"
              onClick={() => onNavigate('/tenant/settings')}
            >
              Settings
            </button>
          </div>
        </header>

        <div className="tenant-app-content">{children}</div>
      </div>
    </div>
  );
}
