import type { NextFunction, Request, Response } from 'express';
import { insforgeUrl, isAuthRequired } from '../config/security.js';

export type AuthedUser = { id: string; email?: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const PUBLIC_PATHS = new Set(['/health', '/health/ready', '/health/live']);

const cache = new Map<string, { user: AuthedUser; expiresAt: number }>();
const CACHE_MS = 30_000;

const readBearer = (req: Request) => {
  const header = req.header('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
};

const verifyInsForgeToken = async (token: string): Promise<AuthedUser | null> => {
  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const base = insforgeUrl();
  if (!base) return null;

  const response = await fetch(`${base}/api/auth/sessions/current`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { user?: { id?: string; email?: string } } | null;
  const id = body?.user?.id;
  if (!id) return null;
  const user = { id, email: body?.user?.email };
  cache.set(token, { user, expiresAt: Date.now() + CACHE_MS });
  if (cache.size > 2000) {
    const now = Date.now();
    for (const [key, value] of cache) {
      if (value.expiresAt <= now) cache.delete(key);
    }
  }
  return user;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (!isAuthRequired()) return next();

  const token = readBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in required.' });
  }

  try {
    const user = await verifyInsForgeToken(token);
    if (!user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Session expired. Sign in again.' });
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Unable to verify session.' });
  }
};
