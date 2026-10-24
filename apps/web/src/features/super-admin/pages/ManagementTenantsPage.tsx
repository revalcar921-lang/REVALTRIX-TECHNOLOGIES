import { useEffect, useState } from 'react';
import { listPlatformTenants, type PlatformTenant } from '../api/super-admin.api.js';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function statusBadge(status: string): React.ReactNode {
  const isActive = status === 'ACTIVE';
  return (
    <span
      className={`management-status-badge ${
        isActive ? 'is-active' : 'is-inactive'
      }`}
    >
      {isActive ? 'Active' : status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
    </span>
  );
}

export function ManagementTenantsPage({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadTenants(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const data = await listPlatformTenants();
      setTenants(data);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load organizations.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTenants();
  }, []);

  if (loading) {
    return (
      <main className="management-page">
        <p role="status">Loading organizations…</p>
      </main>
    );
  }

  return (
    <main className="management-page">
      <header className="management-page-header">
        <p className="management-page-eyebrow">TENANT OVERSIGHT</p>
        <h1>Organizations</h1>
        <p className="management-page-description">
          View and manage all healthcare organizations registered on the platform.
        </p>
      </header>

      {error && (
        <div className="management-alert is-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="management-alert is-success" role="status">
          {notice}
        </div>
      )}

      <div className="management-tenant-table-wrapper">
        <table className="management-tenant-table">
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
                    <span className="management-tenant-type">
                      {tenant.type
                        .split('_')
                        .map(
                          (part) =>
                            part.charAt(0).toUpperCase() +
                            part.slice(1).toLowerCase(),
                        )
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
    </main>
  );
}
