import type { ErrorRequestHandler, Request, Response } from 'express';
import { isProduction } from '../config/security.js';

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({ error: 'NOT_FOUND' });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const code = (err as { code?: string }).code;
  const status = Number((err as { status?: number }).status) || 500;
  console.error(err);

  if (code === 'UPLOAD_SESSION_NOT_FOUND') {
    return res.status(404).json({ error: code });
  }
  if (code === 'INCOMPLETE_UPLOAD' || code === 'INVALID_PDF') {
    return res.status(422).json({ error: code });
  }
  if (code === 'FILE_TOO_LARGE' || code === 'CHUNK_TOO_LARGE') {
    return res.status(413).json({ error: code });
  }
  if (code === 'INVALID_FILENAME' || code === 'INVALID_CHECKSUM' || code === 'INVALID_CHUNK_COUNT' || code === 'INVALID_ID') {
    return res.status(400).json({ error: code });
  }

  const payload: { error: string; message?: string } = { error: 'INTERNAL_SERVER_ERROR' };
  if (!isProduction()) {
    payload.message = err instanceof Error ? err.message : 'Server error';
  }
  res.status(status >= 400 && status < 600 ? status : 500).json(payload);
};
