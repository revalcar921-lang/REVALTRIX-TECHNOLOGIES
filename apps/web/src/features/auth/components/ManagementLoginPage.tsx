import { useState, type FormEvent } from 'react';
import { login } from '../api/auth.api.js';
import { clearAuthSession, storeAuthenticationResponse } from '../../../lib/auth-api.js';
import { getAuthSession, setAuthSession } from '../../../features/auth/api/auth-session.js';
import { ApiRequestError } from '../../../lib/api.js';
import { verifyManagementAccess } from '../api/management-access.api.js';
import { requestManagementLoginVerification, verifyManagementLoginCode } from '../api/management-verification.api.js';

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
  const [verificationStep, setVerificationStep] = useState<'idle' | 'code_sent' | 'entering' | 'verified'>('idle');
  const [challengeId, setChallengeId] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationSubmitting, setVerificationSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!identifier.trim() || !password) {
      setError('Enter your email and password.');
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
          setError('Access denied. Not authorized for the management portal.');
        } else {
          setError('Unable to verify management access. Please try again.');
        }
        return;
      }

      try {
        const verification = await requestManagementLoginVerification();
        setChallengeId(verification.challengeId);
        setVerificationStep('code_sent');
        setError(null);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to send security code. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!verificationCode.trim() || verificationCode.length !== 6) {
      setError('Enter the 6-digit security code sent to your email.');
      return;
    }

    setVerificationSubmitting(true);
    setError(null);

    try {
      await verifyManagementLoginCode({
        challengeId,
        code: verificationCode.trim(),
      });

      const session = getAuthSession();
      if (session) {
        setAuthSession({
          ...session,
          stepUpVerified: true,
        });
      }

      setVerificationStep('verified');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid security code. Please try again.');
    } finally {
      setVerificationSubmitting(false);
    }
  }

  const isCodeStep = verificationStep === 'code_sent' || verificationStep === 'entering';

  return (
    <main className="management-login-page">
      <div className="management-login-center">
        <section className="management-login-card">
          {!isCodeStep ? (
            <>
              <div className="management-login-header">
                <p className="management-login-eyebrow">REVALTRIX</p>
                <h1>Management sign in</h1>
              </div>

              <form className="management-login-form" onSubmit={handleSubmit} noValidate>
                <label>
                  Login method
                  <select
                    value={identityType}
                    onChange={(event) =>
                      setIdentityType(event.target.value as 'EMAIL' | 'PHONE')}
                    disabled={submitting || verificationStep !== 'idle'}
                  >
                    <option value="EMAIL">Email</option>
                    <option value="PHONE">Phone</option>
                  </select>
                </label>

                <label>
                  {identityType === 'EMAIL' ? 'Email address' : 'Phone number'}
                  <input
                    type={identityType === 'EMAIL' ? 'email' : 'tel'}
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    autoComplete={identityType === 'EMAIL' ? 'email' : 'tel'}
                    disabled={submitting || verificationStep !== 'idle'}
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
                    disabled={submitting || verificationStep !== 'idle'}
                    required
                  />
                </label>

                {error ? (
                  <p role="alert" className="management-login-error">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  className="management-login-button"
                  disabled={submitting || verificationStep !== 'idle'}
                >
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>

                <p className="management-login-footer">
                  <a href="/login">Go to regular sign in</a>
                </p>
              </form>
            </>
          ) : (
            <>
              <div className="management-login-header">
                <p className="management-login-eyebrow">REVALTRIX</p>
                <h1>Security code</h1>
              </div>

              <form className="management-login-form" onSubmit={handleVerifyCode} noValidate>
                <p className="management-login-hint">
                  A security code has been sent to your email. Enter it below.
                </p>

                <label>
                  Security code
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    value={verificationCode}
                    onChange={(event) =>
                      setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    autoComplete="one-time-code"
                    disabled={verificationSubmitting}
                    required
                  />
                </label>

                {error ? (
                  <p role="alert" className="management-login-error">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  className="management-login-button"
                  disabled={verificationSubmitting || verificationCode.length !== 6}
                >
                  {verificationSubmitting ? 'Verifying…' : 'Verify code'}
                </button>

                <p className="management-login-footer">
                  <button
                    type="button"
                    onClick={() => {
                      setVerificationStep('idle');
                      setChallengeId('');
                      setVerificationCode('');
                      setError(null);
                    }}
                    className="management-login-resend"
                  >
                    Resend code
                  </button>
                </p>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
