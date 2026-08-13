import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthUser, authErrorMessage, insforge, isAuthConfigured } from '../lib/insforge';
import { EyeIcon, EyeOffIcon, ShieldIcon, SparklesIcon, SpinnerIcon } from '../components/Icons';
import ThemeToggle from '../components/ThemeToggle';

type Mode = 'signin' | 'signup';
type Stage = 'form' | 'verify' | 'check-email' | 'forgot';

const HIGHLIGHTS = [
  {
    title: 'Answers grounded in your PDFs',
    body: 'Every response cites the pages it came from, so you can verify before you trust it.'
  },
  {
    title: 'Chapter analysis and concept maps',
    body: 'Turn dense documents into structured summaries and interactive knowledge graphs.'
  },
  {
    title: 'Your library stays private',
    body: 'Documents are tied to your account and never shared between users.'
  }
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading, setUser } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [stage, setStage] = useState<Stage>('form');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from || '/';

  useEffect(() => {
    if (!loading && user) navigate(redirectTo, { replace: true });
  }, [loading, user, navigate, redirectTo]);

  // Email-verification links land back here with a status query param.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('insforge_type') !== 'verify_email') return;

    if (params.get('insforge_status') === 'success') {
      setNotice('Email verified. Sign in to continue.');
    } else {
      setError(params.get('insforge_error') || 'We could not verify that link. Request a new one.');
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, [location.search]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setStage('form');
    setError('');
    setNotice('');
    setPassword('');
    setCode('');
  };

  const handleSignIn = async () => {
    const { data, error: signInError } = await insforge!.auth.signInWithPassword({ email, password });

    if (signInError) {
      if ((signInError as { statusCode?: number }).statusCode === 403) {
        setStage('verify');
        setError('Your email is not verified yet. Enter the code we sent you.');
        return;
      }
      setError(authErrorMessage(signInError, 'Incorrect email or password.'));
      return;
    }

    setUser((data?.user as AuthUser | undefined) ?? null);
    navigate(redirectTo, { replace: true });
  };

  const handleSignUp = async () => {
    const { data, error: signUpError } = await insforge!.auth.signUp({
      email,
      password,
      name: name.trim() || undefined,
      redirectTo: `${window.location.origin}/login`
    });

    if (signUpError) {
      setError(authErrorMessage(signUpError, 'We could not create that account.'));
      return;
    }

    if (data?.requireEmailVerification) {
      // Code flow shows an input here; link flow tells the user to check email.
      // Both are safe to offer, so keep the user in the verification step.
      setStage('verify');
      setNotice(`We sent a verification code to ${email}.`);
      return;
    }

    if (data?.accessToken) {
      setUser((data?.user as AuthUser | undefined) ?? null);
      navigate(redirectTo, { replace: true });
    }
  };

  const handleVerify = async () => {
    const { data, error: verifyError } = await insforge!.auth.verifyEmail({ email, otp: code.trim() });

    if (verifyError) {
      setError(authErrorMessage(verifyError, 'That code is invalid or has expired.'));
      return;
    }

    // verifyEmail saves the session, so the user is signed in already.
    setUser((data?.user as AuthUser | undefined) ?? null);
    navigate(redirectTo, { replace: true });
  };

  const handleForgot = async () => {
    const { error: resetError } = await insforge!.auth.sendResetPasswordEmail({
      email,
      redirectTo: `${window.location.origin}/login`
    });

    if (resetError) {
      setError(authErrorMessage(resetError, 'We could not send the reset email.'));
      return;
    }

    setStage('check-email');
    setNotice(`If an account exists for ${email}, a password reset link is on its way.`);
  };

  const handleResend = async () => {
    setError('');
    try {
      await insforge!.auth.resendVerificationEmail({
        email,
        redirectTo: `${window.location.origin}/login`
      });
      setNotice(`We sent another code to ${email}.`);
    } catch (reason) {
      setError(authErrorMessage(reason, 'We could not resend the code.'));
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !insforge) return;

    setBusy(true);
    setError('');
    setNotice('');

    try {
      if (stage === 'forgot') await handleForgot();
      else if (stage === 'verify') await handleVerify();
      else if (mode === 'signup') await handleSignUp();
      else await handleSignIn();
    } catch (reason) {
      setError(authErrorMessage(reason, 'Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthConfigured) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-surface-muted px-6">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="max-w-md rounded-2xl bg-surface p-8 text-center shadow-card">
          <h1 className="font-display text-xl font-semibold text-ink-950">Sign-in is not configured</h1>
          <p className="mt-3 text-sm text-ink-600">
            Set <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs">VITE_INSFORGE_URL</code> and{' '}
            <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs">VITE_INSFORGE_ANON_KEY</code> in your{' '}
            <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs">.env</code>, then restart the dev server.
          </p>
          <Link to="/" className="btn-primary mt-6 w-full">
            Continue without signing in
          </Link>
        </div>
      </div>
    );
  }

  const submitLabel =
    stage === 'forgot'
      ? 'Send reset link'
      : stage === 'verify'
        ? 'Verify and continue'
        : mode === 'signup'
          ? 'Create account'
          : 'Sign in';

  return (
    <div className="relative flex min-h-screen bg-surface-muted">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#142028] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />

        <div className="relative">
          <span className="font-display text-xl font-semibold tracking-tight">
            PDF<span className="text-brand-400">Chat</span>
          </span>
        </div>

        <div className="relative animate-fade-up">
          <h2 className="font-display text-3xl font-semibold leading-tight">
            Ask your documents anything.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">
            Upload a PDF and get precise, cited answers in seconds — plus chapter breakdowns and
            concept maps that make long documents easy to navigate.
          </p>

          <ul className="mt-10 space-y-6">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <SparklesIcon className="h-4 w-4 text-teal-300" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-white/55">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-white/45">
          <ShieldIcon className="h-4 w-4" />
          Secured by InsForge authentication
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-8 lg:hidden">
            <span className="font-display text-xl font-semibold tracking-tight text-ink-950">
              PDF<span className="text-brand-600">Chat</span>
            </span>
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950">
            {stage === 'forgot'
              ? 'Reset your password'
              : stage === 'verify'
                ? 'Verify your email'
                : mode === 'signup'
                  ? 'Create your account'
                  : 'Welcome back'}
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            {stage === 'forgot'
              ? 'We will email you a link to choose a new password.'
              : stage === 'verify'
                ? `Enter the 6-digit code sent to ${email}.`
                : mode === 'signup'
                  ? 'Start chatting with your documents in under a minute.'
                  : 'Sign in to reach your document library.'}
          </p>

          {stage === 'form' && (
            <div className="mt-6 flex rounded-xl bg-ink-100 p-1">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  mode === 'signin' ? 'bg-surface text-ink-950 shadow-card' : 'text-ink-600 hover:text-ink-800'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  mode === 'signup' ? 'bg-surface text-ink-950 shadow-card' : 'text-ink-600 hover:text-ink-800'
                }`}
              >
                Create account
              </button>
            </div>
          )}

          {notice && (
            <p className="panel-brand mt-6 rounded-xl px-4 py-3 text-sm">
              {notice}
            </p>
          )}
          {error && (
            <p className="panel-danger mt-4 rounded-xl px-4 py-3 text-sm">
              {error}
            </p>
          )}

          {stage === 'check-email' ? (
            <button type="button" onClick={() => switchMode('signin')} className="btn-ghost mt-8 w-full">
              Back to sign in
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {stage === 'form' && mode === 'signup' && (
                <Field label="Full name" htmlFor="name">
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    placeholder="Basavaraj"
                    className="input-field"
                  />
                </Field>
              )}

              {stage !== 'verify' && (
                <Field label="Email address" htmlFor="email">
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="input-field"
                  />
                </Field>
              )}

              {stage === 'form' && (
                <Field
                  label="Password"
                  htmlFor="password"
                  action={
                    mode === 'signin' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStage('forgot');
                          setError('');
                          setNotice('');
                        }}
                        className="text-xs font-medium text-brand-700 hover:text-brand-800"
                      >
                        Forgot password?
                      </button>
                    ) : undefined
                  }
                >
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                      className="input-field pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </Field>
              )}

              {stage === 'verify' && (
                <Field label="Verification code" htmlFor="code">
                  <input
                    id="code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="input-field text-center text-lg tracking-[0.5em]"
                  />
                </Field>
              )}

              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy && <SpinnerIcon />}
                {submitLabel}
              </button>

              {stage === 'verify' && (
                <div className="flex items-center justify-between text-xs">
                  <button type="button" onClick={handleResend} className="font-medium text-brand-700 hover:text-brand-800">
                    Resend code
                  </button>
                  <button type="button" onClick={() => switchMode('signin')} className="text-ink-500 hover:text-ink-700">
                    Use a different email
                  </button>
                </div>
              )}

              {stage === 'forgot' && (
                <button type="button" onClick={() => switchMode('signin')} className="btn-ghost w-full">
                  Back to sign in
                </button>
              )}
            </form>
          )}

          {stage === 'form' && mode === 'signup' && (
            <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
              By creating an account you agree to keep your uploaded documents lawful and to our
              acceptable use of the service.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  action,
  children
}: {
  label: string;
  htmlFor: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-sm font-medium text-ink-700">
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}
