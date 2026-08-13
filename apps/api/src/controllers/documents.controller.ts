import { Request, Response } from 'express';
import path from 'path';
import { getDatabase } from '../utils/database.utils.js';
import { initUploadSession, saveUploadChunk, completeUploadSession } from '../services/upload.service.js';
import { pdfQueue } from '../queues/queues.js';
import { searchDocumentByQuery, streamSearchDocumentByQuery } from '../services/search.service.js';
import { logTrainingEvent } from '../services/training.service.js';
import type { ChatTurn } from '../services/query.rewrite.js';
import { invalidateChapterCache } from '../services/chapter.analysis.js';
import { getChapterGraphByNumber, invalidateGraphCache } from '../services/chapter.graph.js';
import { invalidateVocabulary } from '../services/spellcheck.service.js';
import { getDocumentFilePath } from '../services/storage.service.js';
import fs from 'fs/promises';

const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const initUpload = async (req: Request, res: Response) => {
  const { name, size, checksum, chunkCount } = req.body;
  if (!name || !String(name).toLowerCase().endsWith('.pdf') || !Number.isFinite(Number(size)) || Number(size) <= 0 || !checksum || !Number.isInteger(Number(chunkCount)) || Number(chunkCount) <= 0) {
    return res.status(400).json({ error: 'MISSING_UPLOAD_METADATA' });
  }

  const session = await initUploadSession({ name, size: Number(size), checksum, chunkCount: Number(chunkCount) });
  return res.status(201).json(session);
};

export const uploadChunk = async (req: Request, res: Response) => {
  const documentId = req.headers['x-document-id'] as string;
  const chunkIndexHeader = req.headers['x-chunk-index'] as string;
  if (!documentId || chunkIndexHeader == null) {
    return res.status(400).json({ error: 'MISSING_CHUNK_METADATA' });
  }
  const chunkIndex = Number(chunkIndexHeader);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return res.status(400).json({ error: 'INVALID_CHUNK_INDEX' });
  }

  const buffer = req.body as Buffer;
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return res.status(400).json({ error: 'INVALID_CHUNK_PAYLOAD' });
  }

  const result = await saveUploadChunk({ documentId, chunkIndex, buffer });
  return res.status(200).json(result);
};

export const completeUpload = async (req: Request, res: Response) => {
  const { documentId } = req.body;
  if (!documentId) return res.status(400).json({ error: 'MISSING_DOCUMENT_ID' });
  const completion = await completeUploadSession({ documentId });
  if (completion.actualChecksum !== completion.expectedChecksum) {
    return res.status(422).json({ error: 'CHECKSUM_MISMATCH' });
  }
  const db = getDatabase();
  await db.query('UPDATE documents SET status=$2 WHERE id=$1', [documentId, 'QUEUED']);
  await pdfQueue.add('document-processing', { documentId });
  return res.status(200).json({ success: true });
};

export const listDocuments = async (req: Request, res: Response) => {
  const db = getDatabase();
  const result = await db.query('SELECT id, name, size, status, page_count, created_at FROM documents ORDER BY created_at DESC');
  const rows = await Promise.all(
    result.rows.map(async (row) => ({
      ...row,
      sourceAvailable: await fileExists(getDocumentFilePath(row.id))
    }))
  );
  res.json(rows);
};

export const getDocument = async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();
  const result = await db.query('SELECT id, name, size, status, page_count, created_at FROM documents WHERE id=$1', [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
  res.json(result.rows[0]);
};

export const getDocumentFile = async (req: Request, res: Response) => {
  const result = await getDatabase().query('SELECT id, name FROM documents WHERE id=$1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
  try {
    await fs.access(getDocumentFilePath(req.params.id));
    return res.type('application/pdf').sendFile(path.resolve(getDocumentFilePath(req.params.id)));
  } catch {
    return res.status(404).json({ error: 'DOCUMENT_FILE_NOT_FOUND' });
  }
};

export const deleteDocument = async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();
  await db.query('DELETE FROM documents WHERE id=$1', [id]);
  invalidateChapterCache(id);
  invalidateGraphCache(id);
  invalidateVocabulary(id);
  res.status(204).end();
};

export const getDocumentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();
  const result = await db.query('SELECT status FROM documents WHERE id=$1', [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
  res.json(result.rows[0]);
};

export const reprocessDocument = async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();
  const exists = await db.query('SELECT id FROM documents WHERE id=$1', [id]);
  if (!exists.rowCount) return res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });

  // Reprocessing wipes pages/chunks/embeddings, so refuse when the source PDF is
  // gone — otherwise the extracted text is destroyed with no way to rebuild it.
  const sourceAvailable = await fileExists(getDocumentFilePath(id));
  if (!sourceAvailable) {
    return res.status(409).json({
      error: 'SOURCE_FILE_MISSING',
      message: 'The original PDF is no longer in storage. Re-upload the file before reprocessing.'
    });
  }

  // Clear derived data so extraction/chunking/embeddings fully regenerate.
  await db.query(
    `DELETE FROM document_embeddings
     WHERE document_chunk_id IN (SELECT id FROM document_chunks WHERE document_id=$1)`,
    [id]
  );
  await db.query('DELETE FROM document_chunks WHERE document_id=$1', [id]);
  await db.query('DELETE FROM document_pages WHERE document_id=$1', [id]);
  await db.query('DELETE FROM processing_errors WHERE document_id=$1', [id]);

  await db.query('UPDATE documents SET status=$2, page_count=NULL WHERE id=$1', [id, 'QUEUED']);
  invalidateChapterCache(id);
  invalidateGraphCache(id);
  invalidateVocabulary(id);
  await pdfQueue.add('document-processing', { documentId: id });
  res.json({ success: true, message: 'Document queued for full reprocess (extract → chunk → embed).' });
};

export const cancelDocument = async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();
  await db.query('UPDATE documents SET status=$2 WHERE id=$1', [id, 'CANCELLED']);
  res.json({ success: true });
};

const readSearchOptions = (req: Request) => {
  const { conversationId, history, persist, source } = req.body || {};
  const turns: ChatTurn[] = Array.isArray(history)
    ? history
        .filter((turn: ChatTurn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
        .map((turn: ChatTurn) => ({ role: turn.role, content: String(turn.content) }))
        .slice(-8)
    : [];
  const evalRun = req.headers['x-eval-run'] === '1' || source === 'eval';
  return {
    conversationId: typeof conversationId === 'string' ? conversationId : undefined,
    history: turns,
    persist: persist === false || evalRun ? false : undefined,
    source: evalRun ? 'eval' as const : 'api' as const
  };
};

export const searchDocument = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'MISSING_QUERY' });

  const result = await searchDocumentByQuery(id, query, readSearchOptions(req));
  res.json(result);
};

export const searchDocumentStream = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'MISSING_QUERY' });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  req.socket?.setNoDelay?.(true);
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  let closed = false;
  const markClosed = () => {
    closed = true;
  };
  // Use the response close signal — req 'close' fires when the POST body ends, which is too early for SSE.
  res.on('close', markClosed);

  const writeEvent = (payload: unknown) => {
    if (closed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    const flushable = res as Response & { flush?: () => void };
    if (typeof flushable.flush === 'function') flushable.flush();
  };

  try {
    for await (const event of streamSearchDocumentByQuery(id, query, readSearchOptions(req))) {
      if (closed || res.writableEnded) break;
      writeEvent(event);
      if (event.type === 'error' || event.type === 'done') break;
    }
  } catch (error) {
    writeEvent({
      type: 'error',
      message: error instanceof Error ? error.message : 'Stream failed'
    });
  } finally {
    res.off('close', markClosed);
    if (!res.writableEnded) res.end();
  }
};

export const getChapterGraph = async (req: Request, res: Response) => {
  const { id, chapterNumber } = req.params;
  const graphType = String(req.body?.graphType || req.query?.graphType || 'concept_map');
  const allowed = new Set(['concept_map', 'mind_map', 'hierarchy', 'timeline', 'cause_effect']);
  if (!allowed.has(graphType)) {
    return res.status(400).json({ error: 'INVALID_GRAPH_TYPE' });
  }

  const number = Number(chapterNumber);
  if (!Number.isInteger(number) || number <= 0) {
    return res.status(400).json({ error: 'INVALID_CHAPTER_NUMBER' });
  }

  try {
    const result = await getChapterGraphByNumber(id, number, graphType as any);
    return res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'DOCUMENT_NOT_FOUND') {
      return res.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
    }
    console.error('Graph generation failed', error);
    return res.status(500).json({
      type: 'GRAPH_RESPONSE',
      intent: 'GRAPH_GENERATION',
      answer: 'Unable to generate the graph for this chapter right now. Please try again.',
      graph: null,
      sources: []
    });
  }
};

export const recordTrainingFeedback = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { eventType, question, answer, previousAnswer, conversationId, pages, chunkIds, intent, meta } = req.body || {};
  const allowed = new Set(['edit', 'regenerate', 'accepted']);
  if (!allowed.has(String(eventType || ''))) {
    return res.status(400).json({ error: 'INVALID_EVENT_TYPE' });
  }
  await logTrainingEvent({
    documentId: id,
    conversationId: typeof conversationId === 'string' ? conversationId : undefined,
    eventType,
    question,
    answer,
    previousAnswer,
    pages: Array.isArray(pages) ? pages.map(Number).filter(Number.isFinite) : [],
    chunkIds: Array.isArray(chunkIds) ? chunkIds.map(String) : [],
    intent,
    meta: meta && typeof meta === 'object' ? meta : {}
  });
  res.status(201).json({ ok: true });
};
