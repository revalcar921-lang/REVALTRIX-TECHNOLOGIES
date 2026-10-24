import { useEffect, useState } from 'react';
import {
  getPlatformStats,
  listAuditEvents,
  listSecurityEvents,
  type PlatformStats,
} from '../api/super-admin.api.js';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function statCard(title: string, value: string, subtitle: string, color: string): React.ReactNode {
  return (
    <div className="management-stat-card" style={{ borderTop: `3px solid ${color}` }}>
      <span className="management-stat-title">{title}</span>
      <span className="management-stat-value">{value}</span>
      <span className="management-stat-subtitle">{subtitle}</span>
    </div>
  );
}

export function ManagementOverviewPage({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [recentAudit, setRecentAudit] = useState<Array<{
    id: string;
    action: string;
    actorUser: { displayName: string | null; username: string | null } | null;
    createdAt: string;
    outcome: string;
  }>>([]);
  const [recentSecurity, setRecentSecurity] = useState<Array<{
    id: string;
    eventType: string;
    severity: string;
    actorUser: { displayName: string | null; username: string | null } | null;
    createdAt: string;
    outcome: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [platformStats, auditResult, securityResult] = await Promise.all([
        getPlatformStats(),
        listAuditEvents({ limit: 5 }),
        listSecurityEvents({ limit: 5 }),
      ]);
      setStats(platformStats);
      setRecentAudit(auditResult.events);
      setRecentSecurity(securityResult.events);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load platform overview data.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  if (loading) {
    return (
      <main className="management-page">
        <p role="status">Loading platform overview…</p>
      </main>
    );
  }

  return (
    <main className="management-page">
      <header className="management-page-header">
        <p className="management-page-eyebrow">PLATFORM OVERVIEW</p>
        <h1>Platform dashboard</h1>
        <p className="management-page-description">
          Monitor platform health, organization onboarding, and recent activity.
        </p>
      </header>

      {error && (
        <div className="management-alert is-error" role="alert">
          {error}
        </div>
      )}

      <div className="management-stats-grid">
        {statCard(
          'Total organizations',
          formatNumber(stats?.tenantCount ?? 0),
          'Registered healthcare organizations',
          '#2563eb',
        )}
        {statCard(
          'Active organizations',
          formatNumber(stats?.activeTenantCount ?? 0),
          'Organizations with active status',
          '#16a34a',
        )}
        {statCard(
          'Platform users',
          formatNumber(stats?.userCount ?? 0),
          'Internal platform personnel accounts',
          '#7c3aed',
        )}
      </div>

      <div className="management-activity-grid">
        <section className="management-recent-activity">
          <h2>Recent platform activity</h2>
          {recentAudit.length === 0 ? (
            <p className="management-empty">No recent audit events.</p>
          ) : (
            <table className="management-simple-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Outcome</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentAudit.map((event) => (
                  <tr key={event.id}>
                    <td>{event.action}</td>
                    <td>
                      {event.actorUser
                        ? event.actorUser.displayName || event.actorUser.username
                        : 'System'}
                    </td>
                    <td>
                      <span
                        className={`management-outcome-badge ${
                          event.outcome === 'SUCCESS' ? 'is-success' : 'is-danger'
                        }`}
                      >
                        {event.outcome}
                      </span>
                    </td>
                    <td>
                      <time>{new Date(event.createdAt).toLocaleString()}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            type="button"
            className="management-view-all-button"
            onClick={() => {
              window.location.href = '/management/audit';
            }}
          >
            View all audit events
          </button>
        </section>

        <section className="management-recent-security">
          <h2>Recent security events</h2>
          {recentSecurity.length === 0 ? (
            <p className="management-empty">No recent security events.</p>
          ) : (
            <table className="management-simple-table">
              <thead>
                <tr>
                  <th>Event type</th>
                  <th>Severity</th>
                  <th>Actor</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentSecurity.map((event) => (
                  <tr key={event.id}>
                    <td>{event.eventType}</td>
                    <td>
                      <span
                        className={`management-severity-badge ${
                          event.severity === 'HIGH' || event.severity === 'CRITICAL'
                            ? 'is-danger'
                            : event.severity === 'MEDIUM'
                              ? 'is-warning'
                              : 'is-info'
                        }`}
                      >
                        {event.severity}
                      </span>
                    </td>
                    <td>
                      {event.actorUser
                        ? event.actorUser.displayName || event.actorUser.username
                        : 'System'}
                    </td>
                    <td>
                      <time>{new Date(event.createdAt).toLocaleString()}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            type="button"
            className="management-view-all-button"
            onClick={() => {
              window.location.href = '/management/audit';
            }}
          >
            View all security events
          </button>
        </section>
      </div>

      <div className="management-quick-actions">
        <h2>Quick actions</h2>
        <div className="management-action-grid">
          <button
            type="button"
            className="management-action-button primary"
            onClick={() => {
              window.location.href = '/management/tenants';
            }}
          >
            <span>Organizations</span>
            <small>View and manage all registered organizations</small>
          </button>
          <button
            type="button"
            className="management-action-button secondary"
            onClick={() => {
              window.location.href = '/management/approvals';
            }}
          >
            <span>Approvals</span>
            <small>Review pending ownership and access requests</small>
          </button>
          <button
            type="button"
            className="management-action-button secondary"
            onClick={() => {
              window.location.href = '/management/people';
            }}
          >
            <span>People & Permissions</span>
            <small>Manage platform administrators and roles</small>
          </button>
          <button
            type="button"
            className="management-action-button secondary"
            onClick={() => {
              window.location.href = '/management/audit';
            }}
          >
            <span>Audit & Security</span>
            <small>Review audit trails and security events</small>
          </button>
        </div>
      </div>
    </main>
  );
}