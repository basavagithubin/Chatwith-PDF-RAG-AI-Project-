import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import DocumentCard from './DocumentCard';
import {
  ClockIcon,
  FolderIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon
} from './Icons';
import {
  LibraryDocument,
  LibraryFilter,
  LibraryNav,
  LibraryViewMode,
  displayTitle,
  formatRelativeTime,
  getLastOpened,
  getLibraryPrefs,
  getReadingProgress,
  inferCollection,
  isFavorite,
  progressPercent,
  setViewMode
} from '../lib/library.prefs';

type LibraryViewProps = {
  documents: LibraryDocument[];
  isLoading?: boolean;
  nav?: LibraryNav;
  onAddDocument: () => void;
};

const FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'recent', label: 'Recent' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'books', label: 'Books' },
  { id: 'research', label: 'Research' }
];

export default function LibraryView({
  documents,
  isLoading = false,
  nav = 'library',
  onAddDocument
}: LibraryViewProps) {
  const prefs = getLibraryPrefs();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [view, setView] = useState<LibraryViewMode>(prefs.viewMode);
  const [prefsTick, setPrefsTick] = useState(0);

  useEffect(() => {
    if (nav === 'library') setFilter('all');
    else if (nav === 'recent' || nav === 'favorites') setFilter(nav);
    else if (nav === 'collections') setFilter('books');
  }, [nav]);

  const refreshPrefs = () => setPrefsTick((value) => value + 1);

  const filtered = useMemo(() => {
    void prefsTick;
    const needle = query.trim().toLowerCase();

    let list = [...documents];
    if (needle) {
      list = list.filter((doc) => displayTitle(doc.name).toLowerCase().includes(needle) || doc.name.toLowerCase().includes(needle));
    }

    const activeFilter = nav === 'collections' ? filter : nav === 'library' ? filter : nav;
    list = list.filter((doc) => {
      if (activeFilter === 'favorites') return isFavorite(doc.id);
      if (activeFilter === 'recent') return Boolean(getLastOpened(doc.id) || getReadingProgress(doc.id));
      if (activeFilter === 'books') return inferCollection(doc) === 'Books';
      if (activeFilter === 'research') return inferCollection(doc) === 'Research';
      return true;
    });

    list.sort((a, b) => {
      const aTime = getLastOpened(a.id) || a.created_at || '';
      const bTime = getLastOpened(b.id) || b.created_at || '';
      return bTime.localeCompare(aTime);
    });

    return list;
  }, [documents, filter, nav, query, prefsTick]);

  const continueReading = useMemo(() => {
    void prefsTick;
    return documents
      .map((doc) => {
        const progress = getReadingProgress(doc.id);
        const percent = progressPercent(doc.id, doc.page_count);
        if (!progress && percent <= 0) return null;
        return { doc, progress, percent, lastOpened: getLastOpened(doc.id) };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.lastOpened || '').localeCompare(a!.lastOpened || ''))
      .slice(0, 3) as Array<{
      doc: LibraryDocument;
      progress: ReturnType<typeof getReadingProgress>;
      percent: number;
      lastOpened: string | null;
    }>;
  }, [documents, prefsTick]);

  const onViewChange = (next: LibraryViewMode) => {
    setView(next);
    setViewMode(next);
  };

  const title =
    nav === 'recent'
      ? 'Recent'
      : nav === 'favorites'
        ? 'Favorites'
        : nav === 'collections'
          ? 'Collections'
          : 'Library';

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-surface-muted">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink-400">Workspace</p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-950">{title}</h1>
            <p className="mt-1 text-sm text-ink-500">
              {documents.length} document{documents.length === 1 ? '' : 's'} · grounded chat and chapter graphs
            </p>
          </div>
          <button type="button" onClick={onAddDocument} className="btn-primary">
            <PlusIcon className="h-4 w-4" />
            Add Document
          </button>
        </header>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your library…"
              className="input-field h-10 pl-9"
            />
          </label>
          <div className="flex items-center gap-1 rounded-xl border border-ink-200 bg-surface p-1">
            <button
              type="button"
              onClick={() => onViewChange('grid')}
              className={`rounded-lg p-2 transition ${view === 'grid' ? 'bg-ink-100 text-ink-950' : 'text-ink-400 hover:text-ink-700'}`}
              aria-label="Grid view"
            >
              <GridIcon />
            </button>
            <button
              type="button"
              onClick={() => onViewChange('list')}
              className={`rounded-lg p-2 transition ${view === 'list' ? 'bg-ink-100 text-ink-950' : 'text-ink-400 hover:text-ink-700'}`}
              aria-label="List view"
            >
              <ListIcon />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filter === item.id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-surface text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50 hover:text-ink-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {nav === 'library' && !isLoading && continueReading.length > 0 && !query && filter === 'all' && (
          <section className="mt-7">
            <div className="mb-3 flex items-center gap-2">
              <ClockIcon className="h-4 w-4 text-brand-600" />
              <h2 className="text-sm font-semibold text-ink-900">Continue reading</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {continueReading.map(({ doc, percent, progress }) => (
                <Link
                  key={doc.id}
                  to={`/documents/${doc.id}`}
                  className="rounded-2xl border border-ink-200/70 bg-surface p-3.5 transition hover:border-ink-300 hover:shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-950">{displayTitle(doc.name)}</p>
                      <p className="mt-1 text-xs text-ink-500">
                        {progress
                          ? `Page ${progress.page} of ${progress.totalPages || doc.page_count || '—'}`
                          : formatRelativeTime(getLastOpened(doc.id))}
                      </p>
                    </div>
                    <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                      {percent}%
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-900">
              {filter === 'all' ? 'All documents' : FILTERS.find((item) => item.id === filter)?.label}
            </h2>
            <p className="text-xs text-ink-400">{filtered.length} shown</p>
          </div>

          {isLoading && <LibrarySkeleton view={view} />}

          {!isLoading && !documents.length && (
            <EmptyState
              icon={<SparklesIcon className="h-5 w-5" />}
              title="Your library is empty"
              body="Upload a PDF to start chatting, citing pages, and exploring chapter maps."
              actionLabel="Add Document"
              onAction={onAddDocument}
            />
          )}

          {!isLoading && documents.length > 0 && !filtered.length && (
            <EmptyState
              icon={filter === 'favorites' ? <StarIcon className="h-5 w-5" /> : <FolderIcon className="h-5 w-5" />}
              title="No matching documents"
              body={
                query
                  ? `Nothing matched “${query}”. Try another search or clear filters.`
                  : 'Try a different filter, or add documents to this collection from the card menu.'
              }
              actionLabel="Clear filters"
              onAction={() => {
                setQuery('');
                setFilter('all');
              }}
            />
          )}

          {!isLoading && filtered.length > 0 && (
            <div
              className={
                view === 'grid'
                  ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
                  : 'flex flex-col gap-2'
              }
            >
              {filtered.map((document) => (
                <DocumentCard key={document.id} item={document} view={view} onPrefsChange={refreshPrefs} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LibrarySkeleton({ view }: { view: LibraryViewMode }) {
  if (view === 'list') {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-2xl bg-ink-100/80" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-ink-100 bg-surface">
          <div className="aspect-[3/2.2] animate-pulse bg-ink-100" />
          <div className="space-y-2 p-3.5">
            <div className="h-3.5 w-4/5 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-ink-100" />
            <div className="h-2 w-full animate-pulse rounded bg-ink-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-ink-200 bg-surface px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-100 text-ink-600">{icon}</div>
      <h3 className="mt-4 font-display text-base font-semibold text-ink-950">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-ink-500">{body}</p>
      <button type="button" onClick={onAction} className="btn-primary mt-5">
        {actionLabel}
      </button>
    </div>
  );
}
