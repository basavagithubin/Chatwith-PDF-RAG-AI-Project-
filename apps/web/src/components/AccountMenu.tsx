import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ChevronDownIcon, LogoutIcon } from './Icons';

const initialsOf = (label: string) =>
  label
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

export default function AccountMenu() {
  const { user, loading, authEnabled, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!authEnabled) return null;
  if (loading) return <div className="h-9 w-9 animate-soft-pulse rounded-full bg-ink-100" />;
  if (!user) return null;

  const displayName = user.profile?.name || user.email;

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition hover:bg-ink-100"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user.profile?.avatar_url ? (
          <img src={user.profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initialsOf(displayName)}
          </span>
        )}
        <ChevronDownIcon className="h-4 w-4 text-ink-500" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-lift"
        >
          <div className="border-b border-ink-100 px-4 py-3">
            {user.profile?.name && (
              <p className="truncate text-sm font-semibold text-ink-950">{user.profile.name}</p>
            )}
            <p className="truncate text-xs text-ink-500" title={user.email}>
              {user.email}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink-700 transition hover:bg-ink-50"
          >
            <LogoutIcon />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
