import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { RegistrationDashboardPage } from './features/registration/pages/RegistrationDashboardPage.js';
import { LoginPage } from './features/auth/components/LoginPage.js';
import { ManagementLoginPage } from './features/auth/components/ManagementLoginPage.js';
import { verifyManagementAccess } from './features/auth/api/management-access.api.js';
import { RegistrationStartPage } from './features/registration/pages/RegistrationStartPage.js';
import { PatientRegistrationPage } from './features/registration/pages/PatientRegistrationPage.js';
import { TenantRegistrationPage } from './features/registration/pages/TenantRegistrationPage.js';
import {
  getRegistrationDashboard,
  getRegistrationToken,
  setRegistrationToken,
} from './features/registration/api/registration-dashboard.api.js';
import { getAuthSession, clearAuthSession } from './features/auth/api/auth-session.js';
import { AuthenticatedDashboardPage } from './features/dashboard/pages/AuthenticatedDashboardPage.js';
import { PatientDashboardPage } from './features/patient-dashboard/pages/PatientDashboardPage.js';
import { PatientProfilePage } from './features/patient-profile/pages/PatientProfilePage.js';
import { PatientFamilyPage } from './features/patient-family/pages/PatientFamilyPage.js';
import { FamilyVerificationReviewPage } from './features/patient-family/pages/FamilyVerificationReviewPage.js';
import { SuperAdminPage } from './features/dashboard/pages/SuperAdminPage.js';
import { StaffDashboardPage } from './features/staff/pages/StaffDashboardPage.js';
import { DepartmentWorkspacePage } from './features/staff/pages/DepartmentWorkspacePage.js';
import { StaffPasswordResetPage } from './features/staff/pages/StaffPasswordResetPage.js';
import { getMyStaffProfile } from './features/staff/api/staff.api.js';
import { TenantPublicWebsitePage } from './features/tenant-websites/pages/TenantPublicWebsitePage.js';
import { LegalInfoPage } from './features/legal/LegalInfoPage.js';
import './styles.css';

type Route =
  | { name: 'start' }
  | { name: 'patient-registration' }
  | { name: 'tenant-registration' }
  | { name: 'patient-onboarding' }
  | { name: 'registration-dashboard' }
  | { name: 'authenticated-dashboard'; path: string }
  | { name: 'patient-dashboard' }
  | { name: 'patient-profile' }
  | { name: 'patient-family' }
  | { name: 'family-verification-review' }
  | { name: 'super-admin' }
  | { name: 'staff-dashboard' }
  | { name: 'staff-password-reset' }
  | { name: 'staff-department'; departmentId?: string }
  | { name: 'public-website'; slug: string; preview: boolean }
  | { name: 'legal-info'; document: 'terms' | 'privacy' }
  | { name: 'login' }
  | { name: 'management-login' }
  | { name: 'management-home' };

function getRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  const websitePath = path.match(/^\/sites\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (websitePath) {
    return {
      name: 'public-website',
      slug: websitePath[1]!,
      preview: new URLSearchParams(window.location.search).get('preview') === '1',
    };
  }

  if (path === '/management/login') return { name: 'management-login' };
  if (path === '/management') return { name: 'management-home' };

  if (path === '/terms') return { name: 'legal-info', document: 'terms' };
  if (path === '/privacy') return { name: 'legal-info', document: 'privacy' };

  if (path === '/register/patient') {
    return { name: 'patient-registration' };
  }

  if (path === '/register/tenant') {
    return { name: 'tenant-registration' };
  }

  if (path === '/register/patient/onboarding') {
    return { name: 'patient-onboarding' };
  }

  if (path === '/register/patient/dashboard' || path === '/register/tenant/dashboard') {
    return { name: 'registration-dashboard' };
  }

  if (path === '/patient/profile') {
    return { name: 'patient-profile' };
  }

  if (path === '/patient/family') {
    return { name: 'patient-family' };
  }

  if (path === '/admin/family-verification') {
    return { name: 'family-verification-review' };
  }

  if (path === '/admin/super' || path === '/admin/tenant-ownership') {
    return { name: 'super-admin' };
  }

  if (path === '/patient/dashboard' || path === '/patient' || path.startsWith('/patient/')) {
    return { name: 'patient-dashboard' };
  }

  if (path === '/staff/dashboard') {
    return { name: 'staff-dashboard' };
  }

  if (path === '/staff/password-reset') {
    return { name: 'staff-password-reset' };
  }

  if (path === '/staff/department') {
    const params = new URLSearchParams(window.location.search);
    return { name: 'staff-department', departmentId: params.get('department') ?? undefined };
  }

  if (path === '/dashboard' || path.startsWith('/tenant/')) {
    return {
      name: 'authenticated-dashboard',
      path,
    };
  }

  if (path === '/login') {
    return { name: 'login' };
  }

  return { name: 'start' };
}

function navigate(path: string): void {
  if (window.location.pathname === path) {
    return;
  }

  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function App() {
  const [route, setRoute] = useState<Route>(getRoute);
  const [checkingSession, setCheckingSession] = useState(true);
  const [accountResolutionError, setAccountResolutionError] = useState<string | null>(null);

  useEffect(() => {
    if (route.name === 'registration-dashboard') {
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const registrationToken = params.get('registration_token');
      if (registrationToken?.trim()) {
        setRegistrationToken(registrationToken.trim());
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }

    if (route.name === 'staff-password-reset') {
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const registrationToken = params.get('registration_token');
      if (registrationToken?.trim()) {
        setRegistrationToken(registrationToken.trim());
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }

    if (route.name !== 'patient-onboarding') {
      return;
    }

    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const registrationToken = params.get('registration_token');

    if (registrationToken?.trim()) {
      window.sessionStorage.setItem('revaltrix_registration_token', registrationToken.trim());

      window.history.replaceState({}, '', '/register/patient/dashboard');

      setRoute({ name: 'registration-dashboard' });
      return;
    }

    const existingToken = window.sessionStorage.getItem('revaltrix_registration_token');

    if (existingToken) {
      window.history.replaceState({}, '', '/register/patient/dashboard');

      setRoute({ name: 'registration-dashboard' });
      return;
    }

    window.history.replaceState({}, '', '/register/patient');
    setRoute({ name: 'patient-registration' });
  }, [route.name]);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRoute());
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolveInitialState(): Promise<void> {
      const authSession = getAuthSession();

      if (authSession) {
        if (route.name === 'management-login' || route.name === 'management-home') {
          try {
            await verifyManagementAccess();
            if (cancelled) return;
            if (route.name === 'management-login') {
              navigate('/management');
            } else {
              setCheckingSession(false);
            }
          } catch {
            if (cancelled) return;
            clearAuthSession();
            if (route.name === 'management-home') {
              navigate('/management/login');
            } else {
              setCheckingSession(false);
            }
          }
          return;
        }

        if (route.name === 'start' || route.name === 'login') {
          try {
            const result = await getMyStaffProfile();
            if (!cancelled) {
              navigate(result.profile ? '/staff/dashboard' : '/dashboard');
            }
          } catch (requestError) {
            if (!cancelled) {
              setAccountResolutionError(
                requestError instanceof Error
                  ? requestError.message
                  : 'Unable to determine your account workspace.',
              );
            }
          } finally {
            if (!cancelled) {
              setCheckingSession(false);
            }
          }
          return;
        }

        if (!cancelled) {
          setCheckingSession(false);
        }
        return;
      }

      if (route.name === 'staff-password-reset') {
        if (!cancelled) {
          setCheckingSession(false);
        }
        return;
      }

      const registrationToken = getRegistrationToken();

      if (!registrationToken) {
        if (!cancelled) {
          setCheckingSession(false);
        }

        return;
      }

      try {
        const registration = await getRegistrationDashboard();

        if (cancelled) {
          return;
        }

        const target =
          registration.registration.type === 'PATIENT'
            ? '/register/patient/dashboard'
            : '/register/tenant/dashboard';

        const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';

        if (
          currentPath === '/' ||
          currentPath === '/register' ||
          currentPath === '/register/patient' ||
          currentPath === '/register/tenant'
        ) {
          navigate(target);
        }
      } catch {
        if (!cancelled) {
          clearAuthSession();
        }
      } finally {
        if (!cancelled) {
          setCheckingSession(false);
        }
      }
    }

    void resolveInitialState();

    return () => {
      cancelled = true;
    };
  }, [route.name]);

  async function navigateAfterLogin(): Promise<void> {
    setCheckingSession(true);
    setAccountResolutionError(null);
    const returnTo = window.sessionStorage.getItem('revaltrix_site_booking_return_to');
    if (returnTo?.startsWith('/sites/') || returnTo === '/patient/appointments') {
      window.sessionStorage.removeItem('revaltrix_site_booking_return_to');
      navigate(returnTo);
      setCheckingSession(false);
      return;
    }
    try {
      const result = await getMyStaffProfile();
      navigate(result.profile ? '/staff/dashboard' : '/dashboard');
    } catch (requestError) {
      setAccountResolutionError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to determine your account workspace.',
      );
    } finally {
      setCheckingSession(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="registration-loading">
        <p>Loading Revaltrix...</p>
      </main>
    );
  }

  if (accountResolutionError) {
    return (
      <main className="registration-loading">
        <h1>Account workspace unavailable</h1>
        <p role="alert">{accountResolutionError}</p>
        <button type="button" onClick={() => void navigateAfterLogin()}>
          Try again
        </button>
        <button
          type="button"
          onClick={() => {
            clearAuthSession();
            setAccountResolutionError(null);
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </main>
    );
  }

  if (route.name === 'authenticated-dashboard') {
    return <AuthenticatedDashboardPage requestedPath={route.path} onNavigate={navigate} />;
  }

  if (route.name === 'patient-dashboard') {
    return (
      <PatientDashboardPage
        onNavigate={navigate}
        onLogout={() => {
          clearAuthSession();
          navigate('/login');
        }}
      />
    );
  }

  if (route.name === 'public-website') {
    return <TenantPublicWebsitePage slug={route.slug} preview={route.preview} onNavigate={navigate} />;
  }

  if (route.name === 'legal-info') {
    return <LegalInfoPage document={route.document} onNavigate={navigate} />;
  }

  if (route.name === 'patient-profile') {
    return (
      <PatientProfilePage
        onNavigate={navigate}
        onLogout={() => {
          clearAuthSession();
          navigate('/login');
        }}
      />
    );
  }

  if (route.name === 'patient-family') {
    return (
      <PatientFamilyPage
        onNavigate={navigate}
        onLogout={() => {
          clearAuthSession();
          navigate('/login');
        }}
      />
    );
  }

  if (route.name === 'staff-dashboard') {
    return (
      <StaffDashboardPage
        onNavigate={navigate}
        onLogout={() => {
          clearAuthSession();
          navigate('/login');
        }}
      />
    );
  }

  if (route.name === 'staff-password-reset') {
    return <StaffPasswordResetPage />;
  }

  if (route.name === 'staff-department') {
    return (
      <DepartmentWorkspacePage
        departmentId={route.departmentId}
        onNavigate={navigate}
        onLogout={() => {
          clearAuthSession();
          navigate('/login');
        }}
      />
    );
  }

  if (route.name === 'family-verification-review') {
    return (
      <FamilyVerificationReviewPage
        onNavigate={navigate}
        onLogout={() => {
          clearAuthSession();
          navigate('/login');
        }}
      />
    );
  }

  if (route.name === 'super-admin') {
    return (
      <SuperAdminPage
        onLogout={() => {
          clearAuthSession();
          navigate('/login');
        }}
      />
    );
  }

  if (route.name === 'patient-onboarding') {
    return (
      <main className="registration-loading">
        <p>Securing your onboarding session...</p>
      </main>
    );
  }

  if (route.name === 'registration-dashboard') {
    return <RegistrationDashboardPage />;
  }

  if (route.name === 'patient-registration') {
    return (
      <PatientRegistrationPage
        onBack={() => navigate('/register')}
        onSuccess={() => navigate('/register/patient/dashboard')}
      />
    );
  }

  if (route.name === 'tenant-registration') {
    return (
      <TenantRegistrationPage
        onBack={() => navigate('/register')}
        onSuccess={() => navigate('/register/tenant/dashboard')}
      />
    );
  }

  if (route.name === 'management-home') {
    return (
      <main className="registration-page">
        <section className="registration-card">
          <div className="registration-header">
            <p className="registration-eyebrow">REVALTRIX TECHNOLOGIES</p>
            <h1>Management portal</h1>
            <p>
              Your management access has been verified. Available workspaces
              and actions must be determined by the platform permissions
              assigned to your account.
            </p>
          </div>
          <button
            type="button"
            className="tenant-button"
            onClick={() => {
              clearAuthSession();
              navigate('/management/login');
            }}
          >
            Sign out
          </button>
        </section>
      </main>
    );
  }

  if (route.name === 'management-login') {
    return <ManagementLoginPage onSuccess={() => navigate('/management')} />;
  }

  if (route.name === 'login') {
    return <LoginPage onSuccess={() => void navigateAfterLogin()} />;
  }

  return (
    <RegistrationStartPage
      onSelectPatient={() => navigate('/register/patient')}
      onSelectTenant={() => navigate('/register/tenant')}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
