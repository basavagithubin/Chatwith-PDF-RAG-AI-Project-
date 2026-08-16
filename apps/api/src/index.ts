import './config/env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import documentsRoutes from './routes/documents.routes.js';
import conversationsRoutes from './routes/conversations.routes.js';
import rateLimitRoutes from './routes/rateLimit.routes.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { corsOrigins, isAuthRequired, isProduction, maxJsonBytes, maxUploadChunkBytes } from './config/security.js';
import { resolveEmbeddingProviderName, resolveLLMProviderName } from './ai/provider.config.js';
import { getDatabase, initDatabase } from './utils/database.utils.js';
import { initQueues } from './queues/queues.js';
import './workers/pdf.worker.js';
import './workers/embedding.worker.js';

const app = express();
const port = Number(process.env.PORT ?? 5000);
const allowedOrigins = corsOrigins();

app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: isProduction() ? { maxAge: 15552000, includeSubDomains: true } : false
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*')) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']
  })
);

app.use(json({ limit: maxJsonBytes() }));
app.use(urlencoded({ extended: true, limit: maxJsonBytes() }));
app.use(
  '/api/documents/upload/chunk',
  express.raw({ type: 'application/octet-stream', limit: maxUploadChunkBytes() })
);

app.get('/health', (_req, res) => {
  const payload: Record<string, unknown> = { status: 'ok' };
  if (!isProduction() || process.env.HEALTH_DETAILS === 'true') {
    payload.providers = {
      llm: resolveLLMProviderName(),
      embedding: resolveEmbeddingProviderName(),
      chatModel: process.env.OPENAI_CHAT_MODEL || null,
      embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || null
    };
  }
  res.json(payload);
});

app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (_req, res) => {
  try {
    await getDatabase().query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unready' });
  }
});

app.use(requireAuth);

const generalLimit = createRateLimiter('general');
const searchLimit = createRateLimiter('search');
const uploadLimit = createRateLimiter('upload');

app.use('/api/rate-limit', generalLimit, rateLimitRoutes);
app.use('/api/conversations', generalLimit, conversationsRoutes);

app.use('/api/documents', (req, res, next) => {
  if (req.path.startsWith('/upload')) {
    return uploadLimit(req, res, next);
  }
  if (/\/search(\/stream)?$|\/chapters\/[^/]+\/graph$/.test(req.path)) {
    return searchLimit(req, res, next);
  }
  return generalLimit(req, res, next);
});

app.use('/api/documents', documentsRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

await initDatabase();
await initQueues();

if (isProduction() && !isAuthRequired()) {
  console.warn('AUTH_REQUIRED is off. API routes are public. Set AUTH_REQUIRED=true for production.');
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`API running on http://0.0.0.0:${port}`);
});
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 120_000);
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 125_000);
