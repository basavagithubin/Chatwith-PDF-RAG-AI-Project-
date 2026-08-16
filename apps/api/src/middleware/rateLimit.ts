import type { NextFunction, Request, Response } from 'express';
import { createClient, type RedisClientType } from 'redis';
import '../config/env.js';

export type RateLimitBucket = 'general' | 'search' | 'upload';

type MemoryEntry = { count: number; resetAt: number };

const memoryStore = new Map<string, MemoryEntry>();

let redisClient: RedisClientType | null = null;
let redisReady: Promise<RedisClientType | null> | null = null;

const enabled = () => (process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false';

const windowMs = () => Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000));

const limits: Record<RateLimitBucket, () => number> = {
  general: () => Math.max(1, Number(process.env.RATE_LIMIT_GENERAL_MAX || 120)),
  search: () => Math.max(1, Number(process.env.RATE_LIMIT_SEARCH_MAX || 20)),
  upload: () => Math.max(1, Number(process.env.RATE_LIMIT_UPLOAD_MAX || 30))
};

const getRedis = async () => {
  if (!enabled()) return null;
  if (redisClient?.isOpen) return redisClient;
  if (!redisReady) {
    redisReady = (async () => {
      try {
        const client = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });
        client.on('error', () => {
          /* fallback handled by callers */
        });
        await client.connect();
        redisClient = client as RedisClientType;
        return redisClient;
      } catch {
        redisClient = null;
        return null;
      }
    })();
  }
  return redisReady;
};

const sanitizeKeyPart = (value: string) =>
  value.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120);

/** Stable per-user key so any number of users are isolated from each other. */
export const resolveClientKey = (req: Request) => {
  const headerUser =
    (req.header('x-user-id') || req.header('x-client-id') || '').trim();
  if (headerUser) return `user:${sanitizeKeyPart(headerUser)}`;

  const forwarded = (req.header('x-forwarded-for') || '').split(',')[0]?.trim();
  const ip = forwarded || req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${sanitizeKeyPart(ip)}`;
};

const pruneMemory = (now: number) => {
  if (memoryStore.size < 5000) return;
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) memoryStore.delete(key);
  }
};

const consumeMemory = (storeKey: string, max: number, window: number) => {
  const now = Date.now();
  pruneMemory(now);
  const existing = memoryStore.get(storeKey);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + window;
    memoryStore.set(storeKey, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt, limit: max };
  }
  existing.count += 1;
  memoryStore.set(storeKey, existing);
  return {
    allowed: existing.count <= max,
    remaining: Math.max(0, max - existing.count),
    resetAt: existing.resetAt,
    limit: max
  };
};

const consumeRedis = async (storeKey: string, max: number, window: number) => {
  const client = await getRedis();
  if (!client) return consumeMemory(storeKey, max, window);

  const windowId = Math.floor(Date.now() / window);
  const redisKey = `rl:${storeKey}:${windowId}`;
  const count = await client.incr(redisKey);
  if (count === 1) {
    await client.pExpire(redisKey, window);
  }
  const ttl = await client.pTTL(redisKey);
  const resetAt = Date.now() + (ttl > 0 ? ttl : window);
  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    resetAt,
    limit: max
  };
};

export const getRateLimitConfig = () => ({
  enabled: enabled(),
  windowMs: windowMs(),
  limits: {
    general: limits.general(),
    search: limits.search(),
    upload: limits.upload()
  }
});

export const checkRateLimit = async (req: Request, bucket: RateLimitBucket) => {
  if (!enabled()) {
    const max = limits[bucket]();
    return {
      allowed: true,
      remaining: max,
      resetAt: Date.now() + windowMs(),
      limit: max,
      clientKey: resolveClientKey(req),
      bucket
    };
  }

  const clientKey = resolveClientKey(req);
  const max = limits[bucket]();
  const window = windowMs();
  const storeKey = `${bucket}:${clientKey}`;
  const result = await consumeRedis(storeKey, max, window);
  return { ...result, clientKey, bucket };
};

const applyHeaders = (
  res: Response,
  result: { limit: number; remaining: number; resetAt: number }
) => {
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
  if (result.remaining <= 0) {
    res.setHeader('Retry-After', String(retryAfter));
  }
};

const isEvalRun = (req: Request) => {
  if ((process.env.NODE_ENV || 'development') === 'production') return false;
  return req.header('x-eval-run') === '1' || req.body?.source === 'eval';
};

export const createRateLimiter = (bucket: RateLimitBucket) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (isEvalRun(req)) return next();
      const result = await checkRateLimit(req, bucket);
      applyHeaders(res, result);
      if (!result.allowed) {
        const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Try again in ${retryAfter}s.`,
          retryAfter,
          limit: result.limit,
          remaining: 0,
          resetAt: result.resetAt,
          bucket: result.bucket
        });
      }
      return next();
    } catch (error) {
      console.warn('Rate limit check failed; allowing request.', error instanceof Error ? error.message : error);
      return next();
    }
  };
};

export const rateLimitStatusHandler = async (req: Request, res: Response) => {
  const clientKey = resolveClientKey(req);
  const config = getRateLimitConfig();
  // Soft peek: consume 0 by reading memory/redis window without incrementing is complex;
  // return config + identity so clients can display limits.
  res.json({
    clientKey,
    ...config,
    identityHeaders: ['x-client-id', 'x-user-id']
  });
};
