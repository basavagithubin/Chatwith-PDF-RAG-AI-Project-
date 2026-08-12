import { Request, Response } from 'express';
import { getDatabase } from '../utils/database.utils.js';
import { v4 as uuidv4 } from 'uuid';

export const createConversation = async (req: Request, res: Response) => {
  const { documentIds } = req.body;
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return res.status(400).json({ error: 'MISSING_DOCUMENT_IDS' });
  }
  const conversationId = uuidv4();
  const db = getDatabase();
  await db.query('INSERT INTO conversations (id, document_ids) VALUES ($1, $2)', [conversationId, documentIds]);
  res.status(201).json({ id: conversationId });
};

export const listConversations = async (req: Request, res: Response) => {
  const db = getDatabase();
  const result = await db.query('SELECT id, document_ids, created_at FROM conversations ORDER BY created_at DESC');
  res.json(result.rows);
};

export const getConversation = async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();
  const result = await db.query('SELECT id, document_ids, created_at FROM conversations WHERE id=$1', [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
  res.json(result.rows[0]);
};

export const addMessage = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role, content } = req.body;
  if (!role || !content) return res.status(400).json({ error: 'MISSING_MESSAGE' });
  const messageId = uuidv4();
  const db = getDatabase();
  await db.query('INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)', [messageId, id, role, content]);
  res.status(201).json({ id: messageId });
};

export const listMessages = async (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();
  const result = await db.query('SELECT id, role, content, created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC', [id]);
  res.json(result.rows);
};

export const streamConversation = async (req: Request, res: Response) => {
  const { id } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: message\n');
  res.write('data: {"fragment":"Streaming is not yet implemented."}\n\n');
  res.write('event: done\n');
  res.write('data: {}\n\n');
  res.end();
};
