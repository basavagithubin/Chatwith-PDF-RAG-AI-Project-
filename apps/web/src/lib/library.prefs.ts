export type LibraryFilter = 'all' | 'recent' | 'favorites' | 'books' | 'research';
export type LibraryViewMode = 'grid' | 'list';
export type LibraryNav = 'library' | 'recent' | 'favorites' | 'collections';

export type LibraryDocument = {
  id: string;
  name: string;
  size?: number;
  status?: string;
  page_count?: number | null;
  created_at?: string;
  sourceAvailable?: boolean;
};

type ReadingProgress = {
  page: number;
  totalPages: number;
  updatedAt: string;
};

type LibraryPrefs = {
  favorites: string[];
  lastOpened: Record<string, string>;
  progress: Record<string, ReadingProgress>;
  collections: Record<string, string[]>;
  viewMode: LibraryViewMode;
};

const STORAGE_KEY = 'pdfchat_library_prefs_v1';

const DEFAULT_PREFS: LibraryPrefs = {
  favorites: [],
  lastOpened: {},
  progress: {},
  collections: {
    Books: [],
    Research: []
  },
  viewMode: 'grid'
};

const readPrefs = (): LibraryPrefs => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS, collections: { ...DEFAULT_PREFS.collections } };
    const parsed = JSON.parse(raw) as Partial<LibraryPrefs>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      lastOpened: parsed.lastOpened && typeof parsed.lastOpened === 'object' ? parsed.lastOpened : {},
      progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {},
      collections:
        parsed.collections && typeof parsed.collections === 'object'
          ? { Books: [], Research: [], ...parsed.collections }
          : { ...DEFAULT_PREFS.collections },
      viewMode: parsed.viewMode === 'list' ? 'list' : 'grid'
    };
  } catch {
    return { ...DEFAULT_PREFS, collections: { ...DEFAULT_PREFS.collections } };
  }
};

const writePrefs = (prefs: LibraryPrefs) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
};

export const getLibraryPrefs = () => readPrefs();

export const setViewMode = (viewMode: LibraryViewMode) => {
  const prefs = readPrefs();
  prefs.viewMode = viewMode;
  writePrefs(prefs);
};

export const toggleFavorite = (documentId: string) => {
  const prefs = readPrefs();
  prefs.favorites = prefs.favorites.includes(documentId)
    ? prefs.favorites.filter((id) => id !== documentId)
    : [...prefs.favorites, documentId];
  writePrefs(prefs);
  return prefs.favorites.includes(documentId);
};

export const isFavorite = (documentId: string) => readPrefs().favorites.includes(documentId);

export const markDocumentOpened = (documentId: string) => {
  const prefs = readPrefs();
  prefs.lastOpened[documentId] = new Date().toISOString();
  writePrefs(prefs);
};

export const setReadingProgress = (documentId: string, page: number, totalPages: number) => {
  const prefs = readPrefs();
  prefs.progress[documentId] = {
    page: Math.max(1, page),
    totalPages: Math.max(page, totalPages),
    updatedAt: new Date().toISOString()
  };
  prefs.lastOpened[documentId] = prefs.progress[documentId].updatedAt;
  writePrefs(prefs);
};

export const getReadingProgress = (documentId: string) => readPrefs().progress[documentId] ?? null;

export const getLastOpened = (documentId: string) => readPrefs().lastOpened[documentId] ?? null;

const BOOK_HINTS = /\b(book|purana|sukta|veda|novel|edition|volume|chapter)\b/i;
const RESEARCH_HINTS = /\b(research|paper|study|thesis|journal|report|analysis)\b/i;

export const inferCollection = (document: LibraryDocument): 'Books' | 'Research' | null => {
  const prefs = readPrefs();
  if (prefs.collections.Books?.includes(document.id)) return 'Books';
  if (prefs.collections.Research?.includes(document.id)) return 'Research';
  const name = document.name || '';
  if (RESEARCH_HINTS.test(name)) return 'Research';
  if (BOOK_HINTS.test(name)) return 'Books';
  return null;
};

export const assignCollection = (documentId: string, collection: 'Books' | 'Research' | null) => {
  const prefs = readPrefs();
  prefs.collections.Books = (prefs.collections.Books || []).filter((id) => id !== documentId);
  prefs.collections.Research = (prefs.collections.Research || []).filter((id) => id !== documentId);
  if (collection) {
    prefs.collections[collection] = [...(prefs.collections[collection] || []), documentId];
  }
  writePrefs(prefs);
};

export const displayTitle = (name: string) =>
  name
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Best-effort author guess from common filename patterns like `author_title.pdf`. */
export const inferAuthor = (name: string) => {
  const base = name.replace(/\.pdf$/i, '');
  const underscored = base.split('_').filter(Boolean);
  if (underscored.length >= 2 && underscored[0].length > 2 && underscored[0].length < 40) {
    return underscored[0]
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return 'Unknown author';
};

export const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatRelativeTime = (iso?: string | null) => {
  if (!iso) return 'Never opened';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'Never opened';
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const progressPercent = (documentId: string, pageCount?: number | null) => {
  const progress = getReadingProgress(documentId);
  if (!progress) return 0;
  const total = progress.totalPages || pageCount || 1;
  return Math.min(100, Math.round((progress.page / total) * 100));
};
