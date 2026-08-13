import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import PdfThumb from './PdfThumb';
import { MoreIcon, StarIcon } from './Icons';
import {
  LibraryDocument,
  LibraryViewMode,
  assignCollection,
  displayTitle,
  formatBytes,
  formatRelativeTime,
  getLastOpened,
  getReadingProgress,
  inferAuthor,
  inferCollection,
  isFavorite,
  progressPercent,
  toggleFavorite
} from '../lib/library.prefs';

type DocumentCardProps = {
  item: LibraryDocument;
  view: LibraryViewMode;
  onPrefsChange: () => void;
};

export default function DocumentCard({ item, view, onPrefsChange }: DocumentCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const favorite = isFavorite(item.id);
  const lastOpened = getLastOpened(item.id) || item.created_at;
  const progress = getReadingProgress(item.id);
  const percent = progressPercent(item.id, item.page_count);
  const title = displayTitle(item.name);
  const author = inferAuthor(item.name);
  const collection = inferCollection(item);
  const pages = item.page_count ? `${item.page_count} pages` : '— pages';
  const statusReady = item.status === 'READY';

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.document.addEventListener('mousedown', onPointer);
    return () => window.document.removeEventListener('mousedown', onPointer);
  }, [menuOpen]);

  const onFavorite = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(item.id);
    onPrefsChange();
  };

  const onAssign = (next: 'Books' | 'Research' | null) => {
    assignCollection(item.id, next);
    setMenuOpen(false);
    onPrefsChange();
  };

  if (view === 'list') {
    return (
      <Link
        to={`/documents/${item.id}`}
        className="group flex items-center gap-3 rounded-2xl border border-ink-200/70 bg-surface px-3 py-2.5 transition hover:border-ink-300 hover:shadow-card lg:grid lg:grid-cols-[48px_minmax(0,1.5fr)_minmax(0,1fr)_100px_96px_88px_auto] lg:gap-3"
      >
        <PdfThumb
          documentId={item.id}
          name={item.name}
          sourceAvailable={item.sourceAvailable !== false && statusReady}
          className="h-12 w-9 shrink-0 rounded-lg shadow-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-950">{title}</p>
          <p className="truncate text-xs text-ink-500">
            {author}
            <span className="lg:hidden">
              {' '}
              · {pages} · {formatRelativeTime(lastOpened)}
            </span>
          </p>
        </div>
        <p className="hidden truncate text-xs text-ink-500 lg:block">
          {pages} · {formatBytes(item.size)}
        </p>
        <p className="hidden truncate text-xs text-ink-500 lg:block">{formatRelativeTime(lastOpened)}</p>
        <div className="hidden items-center gap-2 lg:flex">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
          </div>
          <span className="w-8 text-right text-[11px] text-ink-400">{percent}%</span>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1" onClick={(e) => e.preventDefault()}>
          <button
            type="button"
            onClick={onFavorite}
            className={`rounded-lg p-1.5 transition ${favorite ? 'text-warn-700' : 'text-ink-400 hover:bg-ink-100 hover:text-ink-700'}`}
            aria-label={favorite ? 'Remove favorite' : 'Add favorite'}
          >
            <StarIcon filled={favorite} />
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen((open) => !open);
              }}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              aria-label="Document menu"
            >
              <MoreIcon />
            </button>
            {menuOpen && <CardMenu collection={collection} onAssign={onAssign} />}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={`/documents/${item.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-ink-200/70 bg-surface shadow-card transition hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-lift"
    >
      <div className="relative bg-ink-50 p-3">
        <PdfThumb
          documentId={item.id}
          name={item.name}
          sourceAvailable={item.sourceAvailable !== false && statusReady}
          className="mx-auto w-[72%] shadow-card transition group-hover:shadow-lift"
        />
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={onFavorite}
            className={`rounded-lg bg-surface/95 p-1.5 shadow-sm backdrop-blur ${favorite ? 'text-warn-700 opacity-100' : 'text-ink-500 hover:text-ink-800'}`}
            aria-label={favorite ? 'Remove favorite' : 'Add favorite'}
          >
            <StarIcon filled={favorite} className="h-3.5 w-3.5" />
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen((open) => !open);
              }}
              className="rounded-lg bg-surface/95 p-1.5 text-ink-500 shadow-sm backdrop-blur hover:text-ink-800"
              aria-label="Document menu"
            >
              <MoreIcon className="h-3.5 w-3.5" />
            </button>
            {menuOpen && <CardMenu collection={collection} onAssign={onAssign} />}
          </div>
        </div>
        {favorite && (
          <span className="absolute left-2 top-2 rounded-md bg-warn-50 px-1.5 py-0.5 text-[10px] font-semibold text-warn-700 ring-1 ring-warn-200 group-hover:hidden">
            ★
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 px-3.5 pb-3.5 pt-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink-950">{title}</h3>
          <p className="mt-1 truncate text-xs text-ink-500">{author}</p>
        </div>

        <div className="mt-auto space-y-2">
          <div className="flex items-center justify-between text-[11px] text-ink-400">
            <span>
              {pages} · {formatBytes(item.size)}
            </span>
            <span>{formatRelativeTime(lastOpened)}</span>
          </div>
          {(progress || percent > 0) && (
            <div className="flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
              </div>
              <span className="text-[11px] tabular-nums text-ink-400">{percent}%</span>
            </div>
          )}
          {collection && (
            <span className="inline-flex w-fit rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
              {collection}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function CardMenu({
  collection,
  onAssign
}: {
  collection: 'Books' | 'Research' | null;
  onAssign: (next: 'Books' | 'Research' | null) => void;
}) {
  return (
    <div
      role="menu"
      className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-ink-200 bg-surface py-1 shadow-lift"
      onClick={(e) => e.preventDefault()}
    >
      <MenuItem active={collection === 'Books'} onClick={() => onAssign(collection === 'Books' ? null : 'Books')}>
        {collection === 'Books' ? 'Remove from Books' : 'Add to Books'}
      </MenuItem>
      <MenuItem
        active={collection === 'Research'}
        onClick={() => onAssign(collection === 'Research' ? null : 'Research')}
      >
        {collection === 'Research' ? 'Remove from Research' : 'Add to Research'}
      </MenuItem>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  active
}: {
  children: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full px-3 py-2 text-left text-xs transition hover:bg-ink-50 ${
        active ? 'font-semibold text-brand-700' : 'text-ink-700'
      }`}
    >
      {children}
    </button>
  );
}
