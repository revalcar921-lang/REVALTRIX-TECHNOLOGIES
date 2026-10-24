import type { ReactNode } from 'react';
import { useState } from 'react';
import { Shield, User, Building2, FileText, Activity, LogOut } from 'lucide-react';

interface ManagementDashboardShellProps {
  currentView: string;
  onNavigate: (view: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

const MANAGEMENT_NAV: Array<{
  key: string;
  label: string;
  path: string;
  icon: React.ElementType;
}> = [
  { key: 'overview', label: 'Overview', path: '/management/dashboard', icon: Building2 },
  { key: 'tenants', label: 'Organizations', path: '/management/tenants', icon: Building2 },
  { key: 'approvals', label: 'Approvals', path: '/management/approvals', icon: FileText },
  { key: 'people', label: 'People & Permissions', path: '/management/people', icon: User },
  { key: 'audit', label: 'Audit & Security', path: '/management/audit', icon: Shield },
];

export function ManagementDashboardShell({
  currentView,
  onNavigate,
  onLogout,
  children,
}: ManagementDashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="management-app-shell">
      <aside className={`management-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="management-sidebar-brand" onClick={() => setCollapsed(!collapsed)}>
          <div className="management-brand-mark">R</div>
          <div className="management-brand-text">
            <strong>REVALTRIX</strong>
            {!collapsed && <span>Platform Administration</span>}
          </div>
        </div>

        <nav className="management-sidebar-navigation" aria-label="Management navigation">
          {MANAGEMENT_NAV.map((item) => {
            const active = currentView === item.key;
            return (
              <button
                type="button"
                key={item.key}
                className={`management-nav-item${active ? ' active' : ''}`}
                onClick={() => {
                  onNavigate(item.path);
                  if (collapsed) setCollapsed(false);
                }}
              >
                {collapsed ? (
                  <item.icon className="management-nav-icon-collapsed" size={18} />
                ) : (
                  <>
                    <item.icon className="management-nav-icon" size={16} />
                    <span className="management-nav-label">{item.label}</span>
                  </>
                )}
              </button>
            );
          })}
        </nav>

        <div className="management-sidebar-footer">
          <button type="button" className="management-logout-button" onClick={onLogout}>
            {!collapsed ? <LogOut size={14} /> : null}
            {!collapsed && ' Sign out'}
          </button>
        </div>
      </aside>

      <div className="management-app-main">
        <header className="management-topbar">
          <div className="management-topbar-title">
            {MANAGEMENT_NAV.find((n) => n.key === currentView)?.label ?? 'Management'}
          </div>
          <div className="management-topbar-actions">
            <button
              type="button"
              className="management-topbar-button"
              onClick={() => {
                setCollapsed(!collapsed);
              }}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {collapsed ? '>' : '<'}
            </button>
          </div>
        </header>

        <div className="management-app-content">{children}</div>
      </div>
    </div>
  );
}
