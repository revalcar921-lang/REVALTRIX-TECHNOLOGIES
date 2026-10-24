import { useEffect, useState } from 'react';
import {
  getPlatformStats,
  listPlatformTenants,
  type PlatformStats,
  type PlatformTenant,
} from '../api/super-admin.api.js';
import { verifyManagementAccess } from '../../auth/api/management-access.api.js';
import { clearAuthSession } from '../../auth/api/auth-session.js';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function statusBadge(status: string): React.ReactNode {
  const isActive = status === 'ACTIVE';
  return (
    <span className={`status-badge ${isActive ? 'is-active' : 'is-inactive'}`}>
      {isActive ? 'Active' : status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
    </span>
  );
}

export function SuperAdminDashboardPage({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'overview' | 'tenants'>('overview');

  async function loadPlatformData(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [platformStats, platformTenants] = await Promise.all([
        getPlatformStats(),
        listPlatformTenants(),
      ]);
      setStats(platformStats);
      setTenants(platformTenants);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load platform data.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPlatformData();
  }, []);

  async function handleLogout(): Promise<void> {
    try {
      await verifyManagementAccess();
    } catch {
      // Ignore verification errors on logout
    }
    clearAuthSession();
    onLogout();
  }

  if (loading) {
    return (
      <main className="super-admin-page">
        <p role="status">Loading Revaltrix platform…</p>
      </main>
    );
  }

  return (
    <main className="super-admin-page">
      <header className="super-admin-header">
        <div className="super-admin-brand">
          <div className="super-admin-mark">R</div>
          <div>
            <strong>REVALTRIX</strong>
            <span>Platform Administration</span>
          </div>
        </div>
        <nav className="super-admin-actions">
          <button
            type="button"
            className={`super-admin-tab ${activeView === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveView('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={`super-admin-tab ${activeView === 'tenants' ? 'active' : ''}`}
            onClick={() => setActiveView('tenants')}
          >
            Organizations
          </button>
          <button type="button" className="super-admin-logout" onClick={handleLogout}>
            Sign out
          </button>
        </nav>
      </header>

      {error && (
        <div className="super-admin-alert is-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="super-admin-alert is-success" role="status">
          {notice}
        </div>
      )}

      {activeView === 'overview' ? (
        <section className="super-admin-overview">
          <h1>Platform overview</h1>
          <p>
            Manage Revaltrix platform settings and organizations from here.
          </p>
          <div className="super-admin-stat-cards">
            <div className="super-admin-stat-card">
              <span className="super-admin-stat-label">Total organizations</span>
              <span className="super-admin-stat-value">
                {formatNumber(stats?.tenantCount ?? 0)}
              </span>
            </div>
            <div className="super-admin-stat-card">
              <span className="super-admin-stat-label">Active organizations</span>
              <span className="super-admin-stat-value">
                {formatNumber(stats?.activeTenantCount ?? 0)}
              </span>
            </div>
            <div className="super-admin-stat-card">
              <span className="super-admin-stat-label">Platform users</span>
              <span className="super-admin-stat-value">
                {formatNumber(stats?.userCount ?? 0)}
              </span>
            </div>
          </div>
          <div className="super-admin-quick-actions">
            <h2>Quick actions</h2>
            <p>
              Select <strong>Organizations</strong> from the top navigation to
              view and manage all registered healthcare organizations on the
              platform.
            </p>
          </div>
        </section>
      ) : (
        <section className="super-admin-tenants">
          <h1>Organizations</h1>
          <p>
            View and manage all organizations registered on the Revaltrix
            platform.
          </p>
          <div className="super-admin-tenant-table-wrapper">
            <table className="super-admin-tenant-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Code</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Members</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {tenants.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No organizations found.</td>
                  </tr>
                ) : (
                  tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>
                        <strong>{tenant.name}</strong>
                      </td>
                      <td>
                        <code>{tenant.code}</code>
                      </td>
                      <td>
                        <span className="tenant-type">
                          {tenant.type
                            .split('_')
                            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
                            .join(' ')}
                        </span>
                      </td>
                      <td>{statusBadge(tenant.status)}</td>
                      <td>{formatNumber(tenant.membershipCount)}</td>
                      <td>
                        <time>{new Date(tenant.createdAt).toLocaleDateString()}</time>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}