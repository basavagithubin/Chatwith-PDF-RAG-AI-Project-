import { createClient } from '@insforge/sdk';

const baseUrl = import.meta.env.VITE_INSFORGE_URL as string | undefined;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY as string | undefined;

/**
 * Auth is optional in local development: without credentials the app runs
 * unauthenticated rather than crashing on a missing client.
 */
export const isAuthConfigured = Boolean(baseUrl && anonKey);

export const insforge = isAuthConfigured
  ? createClient({ baseUrl: baseUrl as string, anonKey: anonKey as string })
  : null;

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
