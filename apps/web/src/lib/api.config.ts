const raw = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

/** Local fallback only in Vite dev. Production must set VITE_API_BASE_URL. */
export const API_BASE = raw || (import.meta.env.DEV ? 'http://localhost:5000/api' : '');

export const isApiConfigured = Boolean(API_BASE);
