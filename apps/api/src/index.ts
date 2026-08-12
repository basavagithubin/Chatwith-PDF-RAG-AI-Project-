import './config/env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import documentsRoutes from './routes/documents.routes.js';
import conversationsRoutes from './routes/conversations.routes.js';
import rateLimitRoutes from './routes/rateLimit.routes.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { initDatabase } from './utils/database.utils.js';
import { initQueues } from './queues/queues.js';
import './workers/pdf.worker.js';
import './workers/embedding.worker.js';

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(helmet());
app.use(cors({ origin: true, exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'] }));
app.use(json({ limit: '50mb' }));
app.use(urlencoded({ extended: true, limit: '50mb' }));
app.use('/api/documents/upload/chunk', express.raw({ type: 'application/octet-stream', limit: process.env.UPLOAD_CHUNK_SIZE ?? '50mb' }));

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

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message ?? 'Server error' });
});

await initDatabase();
await initQueues();

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
