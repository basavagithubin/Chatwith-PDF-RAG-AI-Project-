const raw = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

/** Dev uses the local API directly; production defaults to same-origin /api (Vercel proxy). */
export const API_BASE = raw || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api');

export const isApiConfigured = Boolean(API_BASE);
