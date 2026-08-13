import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { SpinnerIcon } from './Icons';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, authEnabled } = useAuth();
  const location = useLocation();

  if (!authEnabled) return <>{children}</>;

  // A cold load refreshes the session over the network; redirecting during that
  // window would bounce already-signed-in users to the login page.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted text-ink-400">
        <SpinnerIcon className="h-6 w-6" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
