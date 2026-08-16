import crypto from 'crypto';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../utils/database.utils.js';
import { UUID_RE, maxFileBytes, maxUploadChunkBytes } from '../config/security.js';
import { isPdfBuffer, sanitizePdfName } from '../middleware/validate.js';
import { ensureStorage, saveChunk, assembleUpload, listUploadChunks, cleanupUpload } from './storage.service.js';

export const initUploadSession = async ({ name, size, checksum, chunkCount }: { name: string; size: number; checksum: string; chunkCount: number; }) => {
  const safeName = sanitizePdfName(name);
  if (!safeName) throw Object.assign(new Error('INVALID_FILENAME'), { code: 'INVALID_FILENAME', status: 400 });
  if (!Number.isFinite(size) || size <= 0 || size > maxFileBytes()) {
    throw Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE', status: 413 });
  }
  const maxChunks = Math.ceil(maxFileBytes() / Math.max(1024, maxUploadChunkBytes())) + 8;
  if (!Number.isInteger(chunkCount) || chunkCount <= 0 || chunkCount > maxChunks) {
    throw Object.assign(new Error('INVALID_CHUNK_COUNT'), { code: 'INVALID_CHUNK_COUNT', status: 400 });
  }
  if (!/^[a-f0-9]{64}$/i.test(checksum)) {
    throw Object.assign(new Error('INVALID_CHECKSUM'), { code: 'INVALID_CHECKSUM', status: 400 });
  }

  await ensureStorage();
  const db = getDatabase();
  const duplicate = await db.query('SELECT id FROM documents WHERE checksum=$1', [checksum]);
  if (duplicate.rowCount) {
    return { documentId: duplicate.rows[0].id, duplicate: true };
  }

  const documentId = uuidv4();
  await db.query(
    'INSERT INTO documents (id, name, size, status, checksum) VALUES ($1, $2, $3, $4, $5)',
    [documentId, safeName, size, 'UPLOADED', checksum]
  );
  await db.query(
    'INSERT INTO upload_sessions (id, document_id, checksum, chunk_count, uploaded_chunks) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), documentId, checksum, chunkCount, 0]
  );

  return { documentId, duplicate: false };
};

export const saveUploadChunk = async ({ documentId, chunkIndex, buffer }: { documentId: string; chunkIndex: number; buffer: Buffer; }) => {
  if (!UUID_RE.test(documentId)) {
    throw Object.assign(new Error('INVALID_ID'), { code: 'INVALID_ID', status: 400 });
  }
  if (!buffer?.length || buffer.length > maxUploadChunkBytes()) {
    throw Object.assign(new Error('CHUNK_TOO_LARGE'), { code: 'CHUNK_TOO_LARGE', status: 413 });
  }
  const db = getDatabase();
  const session = await db.query('SELECT id, chunk_count FROM upload_sessions WHERE document_id=$1', [documentId]);
  if (!session.rowCount) {
    throw new Error('UPLOAD_SESSION_NOT_FOUND');
  }

  await saveChunk(documentId, chunkIndex, buffer);
  const existingChunks = await listUploadChunks(documentId);
  await db.query('UPDATE upload_sessions SET uploaded_chunks=$1 WHERE document_id=$2', [existingChunks.length, documentId]);
  return { uploadedChunks: existingChunks.length, chunkCount: session.rows[0].chunk_count };
};

export const completeUploadSession = async ({ documentId }: { documentId: string }) => {
  const db = getDatabase();
  const session = await db.query('SELECT chunk_count, checksum FROM upload_sessions WHERE document_id=$1', [documentId]);
  if (!session.rowCount) {
    throw new Error('UPLOAD_SESSION_NOT_FOUND');
  }

  const chunkCount = session.rows[0].chunk_count;
  const actualChunks = await listUploadChunks(documentId);
  if (actualChunks.length !== chunkCount) {
    throw new Error('INCOMPLETE_UPLOAD');
  }

  const assembledPath = await assembleUpload(documentId, chunkCount);
  const checksumBuffer = await fs.readFile(assembledPath);
  if (checksumBuffer.length > maxFileBytes()) {
    await fs.unlink(assembledPath).catch(() => undefined);
    throw Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE', status: 413 });
  }
  if (!isPdfBuffer(checksumBuffer)) {
    await fs.unlink(assembledPath).catch(() => undefined);
    throw Object.assign(new Error('INVALID_PDF'), { code: 'INVALID_PDF', status: 422 });
  }
  const actualChecksum = crypto.createHash('sha256').update(checksumBuffer).digest('hex');

  await db.query('UPDATE documents SET status=$2 WHERE id=$1', [documentId, 'QUEUED']);
  await db.query('DELETE FROM upload_sessions WHERE document_id=$1', [documentId]);
  await cleanupUpload(documentId);
  return { documentId, filePath: assembledPath, actualChecksum, expectedChecksum: session.rows[0].checksum };
};
