import { useEffect, useState } from 'react';
import {
  listAuditEvents,
  listSecurityEvents,
  type AuditEvent,
  type SecurityEvent,
} from '../api/super-admin.api.js';

function severityBadge(severity: string): React.ReactNode {
  const isHigh = severity === 'HIGH' || severity === 'CRITICAL';
  const isMedium = severity === 'MEDIUM';
  return (
    <span
      className={`management-severity-badge ${
        isHigh ? 'is-danger' : isMedium ? 'is-warning' : 'is-info'
      }`}
    >
      {severity}
    </span>
  );
}

function outcomeBadge(outcome: string): React.ReactNode {
  return (
    <span
      className={`management-outcome-badge ${
        outcome === 'SUCCESS' ? 'is-success' : 'is-danger'
      }`}
    >
      {outcome}
    </span>
  );
}

export function ManagementAuditPage({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [securityTotal, setSecurityTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'audit' | 'security'>('audit');
  const [page, setPage] = useState(1);

  async function loadAuditData(currentPage: number): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [auditResult, securityResult] = await Promise.all([
        listAuditEvents({ page: currentPage, limit: 20 }),
        listSecurityEvents({ page: currentPage, limit: 20 }),
      ]);
      setAuditEvents(auditResult.events);
      setSecurityEvents(securityResult.events);
      setAuditTotal(auditResult.total);
      setSecurityTotal(securityResult.total);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load audit and security data.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAuditData(page);
  }, [page]);

  const totalPages = Math.ceil(
    (activeTab === 'audit' ? auditTotal : securityTotal) / 20,
  );

  if (loading) {
    return (
      <main className="management-page">
        <p role="status">Loading audit and security data…</p>
      </main>
    );
  }

  return (
    <main className="management-page">
      <header className="management-page-header">
        <p className="management-page-eyebrow">AUDIT & SECURITY</p>
        <h1>Audit and security centre</h1>
        <p className="management-page-description">
          Trace privileged platform actions, security events, and actor attribution.
        </p>
      </header>

      {error && (
        <div className="management-alert is-error" role="alert">
          {error}
        </div>
      )}

      <div className="management-audit-tabs">
        <button
          type="button"
          className={`management-tab-button ${
            activeTab === 'audit' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('audit')}
        >
          Audit events ({formatNumber(auditTotal)})
        </button>
        <button
          type="button"
          className={`management-tab-button ${
            activeTab === 'security' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('security')}
        >
          Security events ({formatNumber(securityTotal)})
        </button>
      </div>

      <div className="management-audit-table-wrapper">
        <table className="management-audit-table">
          <thead>
            <tr>
              {activeTab === 'audit' ? (
                <>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Actor</th>
                  <th>Outcome</th>
                  <th>Time</th>
                </>
              ) : (
                <>
                  <th>Event type</th>
                  <th>Severity</th>
                  <th>Actor</th>
                  <th>Outcome</th>
                  <th>Time</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {activeTab === 'audit' ? (
              auditEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.action}</td>
                  <td>
                    {event.resourceType}
                    {event.resourceId ? ` (${event.resourceId})` : ''}
                  </td>
                  <td>
                    {event.actorUser
                      ? event.actorUser.displayName ||
                        event.actorUser.username
                      : 'System'}
                  </td>
                  <td>{outcomeBadge(event.outcome)}</td>
                  <td>
                    <time>{new Date(event.createdAt).toLocaleString()}</time>
                  </td>
                </tr>
              ))
            ) : (
              securityEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.eventType}</td>
                  <td>{severityBadge(event.severity)}</td>
                  <td>
                    {event.actorUser
                      ? event.actorUser.displayName ||
                        event.actorUser.username
                      : 'System'}
                  </td>
                  <td>{outcomeBadge(event.outcome)}</td>
                  <td>
                    <time>{new Date(event.createdAt).toLocaleString()}</time>
                  </td>
                </tr>
              ))
            )}
            {(activeTab === 'audit' ? auditEvents : securityEvents).length === 0 ? (
              <tr>
                <td colSpan={5}>No events found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="management-pagination">
          <button
            type="button"
            className="management-pagination-button"
            disabled={page === 1}
            onClick={() => {
              setPage(page - 1);
            }}
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
            onClick={() => {
              setPage(page + 1);
            }}
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}