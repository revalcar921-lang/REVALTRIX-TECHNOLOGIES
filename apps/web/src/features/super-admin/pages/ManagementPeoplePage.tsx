import { useEffect, useState } from 'react';
import { listPlatformUsers, type PlatformUser } from '../api/super-admin.api.js';

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

export function ManagementPeoplePage({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  async function loadUsers(currentPage: number): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await listPlatformUsers({ page: currentPage, limit: 20 });
      setUsers(result.users);
      setTotal(result.total);
      setPage(result.page);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load platform users.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers(page);
  }, [page]);

  if (loading) {
    return (
      <main className="management-page">
        <p role="status">Loading platform users…</p>
      </main>
    );
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <main className="management-page">
      <header className="management-page-header">
        <p className="management-page-eyebrow">PEOPLE & PERMISSIONS</p>
        <h1>Platform administrators</h1>
        <p className="management-page-description">
          Manage internal platform personnel and their scoped permissions.
        </p>
      </header>

      {error && (
        <div className="management-alert is-error" role="alert">
          {error}
        </div>
      )}

      <div className="management-people-table-wrapper">
        <table className="management-people-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Platform roles</th>
              <th>Status</th>
              <th>Memberships</th>
              <th>Sessions</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={7}>No platform users found.</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.displayName}</strong>
                  </td>
                  <td>
                    <code>{user.username ?? '—'}</code>
                  </td>
                  <td>
                    {user.platformRoles.length === 0 ? (
                      <span className="management-roles-none">None</span>
                    ) : (
                      <div className="management-roles-list">
                        {user.platformRoles.map((role) => (
                          <span
                            key={role.id}
                            className="management-role-badge"
                          >
                            {role.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{statusBadge(user.status)}</td>
                  <td>{formatNumber(user.membershipCount)}</td>
                  <td>{formatNumber(user.sessionCount)}</td>
                  <td>
                    <time>{new Date(user.createdAt).toLocaleDateString()}</time>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="management-pagination">
          <button
            type="button"
            className="management-pagination-button"
            disabled={page === 1}
            onClick={() => void loadUsers(page - 1)}
          >
            Previous
          </button>
          <span className="management-pagination-info">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="management-pagination-button"
            disabled={page === totalPages}
            onClick={() => void loadUsers(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
