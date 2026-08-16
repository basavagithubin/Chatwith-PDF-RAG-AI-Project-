import '../config/env.js';

const truthy = (value?: string) => /^(1|true|yes|on)$/i.test(String(value || '').trim());

export const isProduction = () => (process.env.NODE_ENV || 'development') === 'production';

export const corsOrigins = () =>
  String(process.env.CORS_ORIGINS || 'http://localhost:4173,http://localhost:5173,http://localhost:8080')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export const isAuthRequired = () => {
  if (process.env.AUTH_REQUIRED != null && process.env.AUTH_REQUIRED !== '') {
    return truthy(process.env.AUTH_REQUIRED);
  }
  return isProduction() && Boolean(process.env.INSFORGE_URL || process.env.VITE_INSFORGE_URL);
};

export const insforgeUrl = () =>
  (process.env.INSFORGE_URL || process.env.VITE_INSFORGE_URL || '').replace(/\/$/, '');

export const maxFileBytes = () => Math.max(1, Number(process.env.MAX_FILE_SIZE || 524288000));

export const maxUploadChunkBytes = () => Math.max(1024, Number(process.env.UPLOAD_CHUNK_SIZE || 10485760));

export const maxJsonBytes = () => Math.max(1024, Number(process.env.JSON_BODY_LIMIT || 1_048_576));

export const maxQueryChars = () => Math.max(32, Number(process.env.MAX_QUERY_CHARS || 4000));

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
