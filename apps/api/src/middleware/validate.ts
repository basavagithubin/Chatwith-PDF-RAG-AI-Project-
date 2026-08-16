import type { NextFunction, Request, Response } from 'express';
import { UUID_RE } from '../config/security.js';

export const requireUuidParam =
  (...names: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    for (const name of names) {
      const value = req.params[name];
      if (value && !UUID_RE.test(value)) {
        return res.status(400).json({ error: 'INVALID_ID' });
      }
    }
    return next();
  };

export const sanitizePdfName = (raw: string) => {
  const base = String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.trim() || '';
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180);
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : '';
};

export const isPdfBuffer = (buffer: Buffer) => {
  if (!buffer || buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
};
