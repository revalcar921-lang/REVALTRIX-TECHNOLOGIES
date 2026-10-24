export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt: string;
  userId: string;
  stepUpVerified?: boolean;
}

const AUTH_SESSION_KEY = 'revaltrix_auth_session';

export function getAuthSession(): AuthSession | null {
  const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthSession;

    if (
      !parsed.accessToken ||
      !parsed.refreshToken ||
      !parsed.sessionId ||
      !parsed.expiresAt ||
      !parsed.userId
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function setAuthSession(session: AuthSession): void {
  window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith('revaltrix_department_access:')) {
      window.sessionStorage.removeItem(key);
    }
  }
}
