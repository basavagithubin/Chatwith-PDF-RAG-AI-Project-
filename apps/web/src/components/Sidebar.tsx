import { Link, useLocation } from 'react-router-dom';
import {
  ClockIcon,
  FolderIcon,
  LibraryIcon,
  PlusIcon,
  StarIcon
} from './Icons';
import { LibraryDocument, LibraryNav, displayTitle } from '../lib/library.prefs';

type SidebarProps = {
  documents: LibraryDocument[];
  isLoading?: boolean;
  activeNav?: LibraryNav;
  onNavChange?: (nav: LibraryNav) => void;
  onNewClick: () => void;
  className?: string;
};

const NAV: Array<{ id: LibraryNav; label: string; icon: typeof LibraryIcon }> = [
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'recent', label: 'Recent', icon: ClockIcon },
  { id: 'favorites', label: 'Favorites', icon: StarIcon },
  { id: 'collections', label: 'Collections', icon: FolderIcon }
];

const statusDot = (status?: string) => {
  if (status === 'READY') return 'bg-brand-500';
  if (status === 'FAILED' || status === 'CANCELLED') return 'bg-danger-700';
  return 'bg-warn-700 animate-soft-pulse';
};

export default function Sidebar({
  documents,
  isLoading,
  activeNav = 'library',
  onNavChange,
  onNewClick,
  className = ''
}: SidebarProps) {
  const location = useLocation();
  const onLibraryHome = location.pathname === '/';
  const recent = documents.slice(0, 6);

  return (
    <aside className={`flex w-[240px] shrink-0 flex-col border-r border-ink-200/70 bg-surface-sidebar ${className}`}>
      <div className="flex items-center justify-between px-3 pb-2 pt-4">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Browse</h2>
        <button
          type="button"
          onClick={onNewClick}
          className="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
          aria-label="Add document"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <nav className="space-y-0.5 px-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = onLibraryHome && activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavChange?.(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${
                active
                  ? 'bg-surface font-semibold text-ink-950 shadow-sm ring-1 ring-ink-100'
                  : 'text-ink-600 hover:bg-surface/70 hover:text-ink-900'
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? 'text-brand-600' : 'text-ink-400'}`} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-5 flex items-center justify-between px-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Documents</h3>
        <span className="text-[11px] tabular-nums text-ink-400">{documents.length}</span>
      </div>

      <div className="mt-1 flex-1 overflow-y-auto px-2 pb-4">
        {isLoading && (
          <div className="space-y-1.5 px-1 pt-1">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-9 animate-pulse rounded-xl bg-ink-100/70" />
            ))}
          </div>
        )}

        {!isLoading && !documents.length && (
          <div className="mx-1 mt-1 rounded-xl border border-dashed border-ink-200 bg-surface/50 px-3 py-5 text-center">
            <p className="text-xs font-medium text-ink-700">No documents yet</p>
            <button type="button" onClick={onNewClick} className="btn-primary mt-3 w-full py-2 text-xs">
              Add Document
            </button>
          </div>
        )}

        <div className="space-y-0.5">
          {recent.map((document) => {
            const active = location.pathname === `/documents/${document.id}`;
            return (
              <Link
                key={document.id}
                to={`/documents/${document.id}`}
                className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] transition ${
                  active
                    ? 'bg-surface font-semibold text-ink-950 shadow-sm ring-1 ring-ink-100'
                    : 'text-ink-700 hover:bg-surface/70'
                }`}
                title={displayTitle(document.name)}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(document.status)}`} />
                <span className="min-w-0 flex-1 truncate">{displayTitle(document.name)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
