import { FormEvent, useState } from 'react';
import { login } from '../api/auth.api.js';
import { storeAuthenticationResponse } from '../../../lib/auth-api.js';
import { resolveAuthenticatedAccount } from '../api/account.api.js';

interface LoginPageProps {
  onSuccess: () => void;
}

export function LoginPage({
  onSuccess,
}: LoginPageProps) {
  const [identityType, setIdentityType] = useState<'EMAIL' | 'PHONE'>(
    'EMAIL',
  );
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!identifier.trim() || !password) {
      setError('Enter your login identifier and password.');
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

      const account = await resolveAuthenticatedAccount();

      if (account.accountType === 'PATIENT') {
        window.history.pushState(
          {},
          '',
          '/patient/dashboard',
        );
        window.dispatchEvent(
          new PopStateEvent('popstate'),
        );
        return;
      }

      if (account.accountType === 'TENANT') {
        window.history.pushState(
          {},
          '',
          '/tenant/dashboard',
        );
        window.dispatchEvent(
          new PopStateEvent('popstate'),
        );
        return;
      }

      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to sign in.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="registration-page">
      <section className="registration-card">
        <div className="registration-header">
          <p className="registration-eyebrow">REVALTRIX</p>
          <h1>Sign in</h1>
          <p>
            Sign in to access your Revaltrix workspace.
          </p>
        </div>

        <form
          className="tenant-form"
          onSubmit={handleSubmit}
          noValidate
        >
          <label>
            Login method
            <select
              value={identityType}
              onChange={(event) =>
                setIdentityType(
                  event.target.value as 'EMAIL' | 'PHONE',
                )
              }
              disabled={submitting}
            >
              <option value="EMAIL">Email</option>
              <option value="PHONE">Phone</option>
            </select>
          </label>

          <label>
            {identityType === 'EMAIL'
              ? 'Email address'
              : 'Phone number'}
            <input
              type={
                identityType === 'EMAIL'
                  ? 'email'
                  : 'tel'
              }
              value={identifier}
              onChange={(event) =>
                setIdentifier(event.target.value)
              }
              autoComplete={
                identityType === 'EMAIL'
                  ? 'email'
                  : 'tel'
              }
              disabled={submitting}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              autoComplete="current-password"
              disabled={submitting}
              required
              minLength={8}
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="registration-error"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="tenant-button"
            disabled={submitting}
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
