import { Link, useLocation } from 'react-router-dom';
import { FileIcon, PlusIcon } from './Icons';

type DocumentItem = {
  id: string;
  name: string;
  status?: string;
};

type SidebarProps = {
  documents: DocumentItem[];
  isLoading?: boolean;
  onNewClick: () => void;
  className?: string;
};

const statusDot = (status?: string) => {
  if (status === 'READY') return 'bg-brand-500';
  if (status === 'FAILED' || status === 'CANCELLED') return 'bg-red-400';
  return 'bg-amber-400 animate-soft-pulse';
};

export default function Sidebar({ documents, isLoading, onNewClick, className = '' }: SidebarProps) {
  const location = useLocation();

  return (
    <aside className={`flex w-[260px] shrink-0 flex-col border-r border-ink-200/80 bg-surface-sidebar ${className}`}>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">Library</h2>
        <button
          type="button"
          onClick={onNewClick}
          className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          aria-label="Upload PDF"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {isLoading && <p className="px-3 py-3 text-sm text-ink-400">Loading documents…</p>}
        {!isLoading && !documents.length && (
          <div className="mx-2 rounded-xl border border-dashed border-ink-200 bg-white/60 px-3 py-6 text-center">
            <p className="text-sm font-medium text-ink-700">No documents yet</p>
            <p className="mt-1 text-xs text-ink-400">Upload a PDF to start chatting</p>
            <button type="button" onClick={onNewClick} className="btn-primary mt-4 w-full">
              Upload PDF
            </button>
          </div>
        )}
        <div className="space-y-1">
          {documents.map((document) => {
            const active = location.pathname === `/documents/${document.id}`;
            return (
              <Link
                key={document.id}
                to={`/documents/${document.id}`}
                className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition ${
                  active
                    ? 'bg-white font-semibold text-ink-950 shadow-card ring-1 ring-ink-100'
                    : 'text-ink-700 hover:bg-white/80'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(document.status)}`} />
                <FileIcon className={`shrink-0 ${active ? 'text-brand-600' : 'text-ink-400'}`} />
                <span className="min-w-0 flex-1 truncate">{document.name.replace(/\.pdf$/i, '')}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="border-t border-ink-200/80 p-4">
        <p className="font-display text-sm font-semibold text-ink-900">Ask · Map · Understand</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          Chat with chapters, open citations, and explore concept graphs grounded in your PDF.
        </p>
      </div>
    </aside>
  );
}
