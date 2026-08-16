import { createClient } from '@insforge/sdk';

const baseUrl = String(import.meta.env.VITE_INSFORGE_URL || '').trim();
const anonKey = String(import.meta.env.VITE_INSFORGE_ANON_KEY || '').trim();

const createInsforgeClient = () => {
  if (!baseUrl || !anonKey) return null;
  try {
    return createClient({ baseUrl, anonKey });
  } catch (error) {
    console.error('InsForge client failed to initialize', error);
    return null;
  }
};

/**
 * Auth is optional: without credentials the app runs unauthenticated
 * rather than crashing on a missing or invalid client.
 */
export const insforge = createInsforgeClient();
export const isAuthConfigured = Boolean(insforge);

export const getAccessToken = async () => {
  if (!insforge) return null;
  try {
    return (await insforge.getHttpClient().getValidAccessToken()) || null;
  } catch {
    return null;
  }
};

export type AuthUser = {
  id: string;
  email: string;
  profile?: {
    name?: string;
    avatar_url?: string;
  } | null;
};

/** InsForge returns { data, error }; surface a readable message either way. */
export const authErrorMessage = (error: unknown, fallback: string) => {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  const message = (error as { message?: string }).message;
  return message && message.trim() ? message : fallback;
};
