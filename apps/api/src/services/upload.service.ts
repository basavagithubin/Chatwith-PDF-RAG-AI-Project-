import path from 'path';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../utils/database.utils.js';
import { ensureStorage, saveChunk, assembleUpload, listUploadChunks, cleanupUpload } from './storage.service.js';

export const initUploadSession = async ({ name, size, checksum, chunkCount }: { name: string; size: number; checksum: string; chunkCount: number; }) => {
  await ensureStorage();
  const db = getDatabase();
  const duplicate = await db.query('SELECT id FROM documents WHERE checksum=$1', [checksum]);
  if (duplicate.rowCount) {
    return { documentId: duplicate.rows[0].id, duplicate: true };
  }

  const documentId = uuidv4();
  await db.query(
    'INSERT INTO documents (id, name, size, status, checksum) VALUES ($1, $2, $3, $4, $5)',
    [documentId, name, size, 'UPLOADED', checksum]
  );
  await db.query(
    'INSERT INTO upload_sessions (id, document_id, checksum, chunk_count, uploaded_chunks) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), documentId, checksum, chunkCount, 0]
  );

  return { documentId, duplicate: false };
};

export const saveUploadChunk = async ({ documentId, chunkIndex, buffer }: { documentId: string; chunkIndex: number; buffer: Buffer; }) => {
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
  const actualChecksum = crypto.createHash('sha256').update(checksumBuffer).digest('hex');

  await db.query('UPDATE documents SET status=$2 WHERE id=$1', [documentId, 'QUEUED']);
  await db.query('DELETE FROM upload_sessions WHERE document_id=$1', [documentId]);
  await cleanupUpload(documentId);
  return { documentId, filePath: assembledPath, actualChecksum, expectedChecksum: session.rows[0].checksum };
};
