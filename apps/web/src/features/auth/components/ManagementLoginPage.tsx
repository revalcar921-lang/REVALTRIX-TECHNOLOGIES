import { useState, type FormEvent } from 'react';
import { login } from '../api/auth.api.js';
import { clearAuthSession, storeAuthenticationResponse } from '../../../lib/auth-api.js';
import { ApiRequestError } from '../../../lib/api.js';
import { verifyManagementAccess } from '../api/management-access.api.js';

interface ManagementLoginPageProps {
  onSuccess: () => void;
}

export function ManagementLoginPage({
  onSuccess,
}: ManagementLoginPageProps) {
  const [identityType, setIdentityType] = useState<'EMAIL' | 'PHONE'>('EMAIL');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!identifier.trim() || !password) {
      setError('Enter your work email or phone number and password.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const authentication = await login({
        identityType,
        identifier: identifier.trim(),
        password,
      });

      await storeAuthenticationResponse(authentication);

      try {
        await verifyManagementAccess();
      } catch (accessError) {
        if (accessError instanceof ApiRequestError && accessError.status === 403) {
          clearAuthSession();
          setError(
            'Access denied. This account is not authorized for the Revaltrix management portal. Contact your platform administrator.',
          );
        } else {
          setError('Unable to verify management access. Please try again.');
        }
        return;
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-header">
          <p className="registration-eyebrow">REVALTRIX TECHNOLOGIES</p>
          <h1>Management sign in</h1>
          <p>
            Restricted access for authorized Revaltrix internal personnel.
            Patient and healthcare facility accounts use the regular sign-in page.
          </p>
        </div>

        <form className="tenant-form" onSubmit={handleSubmit} noValidate>
          <label>
            Login method
            <select
              value={identityType}
              onChange={(event) =>
                setIdentityType(event.target.value as 'EMAIL' | 'PHONE')
              }
              disabled={submitting}
            >
              <option value="EMAIL">Work email</option>
              <option value="PHONE">Phone</option>
            </select>
          </label>

          <label>
            {identityType === 'EMAIL' ? 'Work email address' : 'Phone number'}
            <input
              type={identityType === 'EMAIL' ? 'email' : 'tel'}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete={identityType === 'EMAIL' ? 'username' : 'tel'}
              disabled={submitting}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={submitting}
              required
            />
          </label>

          {error ? (
            <p role="alert" className="registration-error">
              {error}
            </p>
          ) : null}

          <button type="submit" className="tenant-button" disabled={submitting}>
            {submitting ? 'Verifying access...' : 'Sign in to management'}
          </button>

          <p>
            <a href="/login">Go to regular sign in</a>
          </p>
        </form>
      </section>
    </main>
  );
}
