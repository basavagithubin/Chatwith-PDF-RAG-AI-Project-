import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const config = {
  api: {
    bodyParser: false
  },
  maxDuration: 120
};

const backendOrigin = () => {
  const raw = String(process.env.API_BACKEND_URL || '').trim();
  if (!raw) return '';
  return raw.replace(/\/$/, '').replace(/\/api$/, '');
};

const forwardHeaders = (req: VercelRequest) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || key === 'host' || key === 'connection') continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = backendOrigin();
  if (!origin) {
    res.status(503).json({
      error: 'not_configured',
      message:
        'Set API_BACKEND_URL in Vercel to your Express API host (for example https://your-api.onrender.com). Requests to /api on this site are proxied to that host.'
    });
    return;
  }

  const parts = req.query.path;
  const suffix = Array.isArray(parts) ? parts.join('/') : parts || '';
  const queryIndex = req.url?.indexOf('?') ?? -1;
  const query = queryIndex >= 0 ? req.url!.slice(queryIndex) : '';
  const target = `${origin}/api/${suffix}${query}`;

  const hasBody = Boolean(req.method && !['GET', 'HEAD'].includes(req.method));
  const upstream = await fetch(target, {
    method: req.method,
    headers: forwardHeaders(req),
    body: hasBody ? (req as unknown as BodyInit) : undefined,
    // @ts-expect-error Node fetch needs duplex when streaming request bodies.
    duplex: hasBody ? 'half' : undefined
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return;
    res.setHeader(key, value);
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  await pipeline(Readable.fromWeb(upstream.body as import('stream/web').ReadableStream), res);
}
