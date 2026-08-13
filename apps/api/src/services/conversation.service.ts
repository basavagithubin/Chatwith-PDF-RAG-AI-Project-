import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../utils/database.utils.js';
import type { ChatTurn } from './query.rewrite.js';

export const ensureConversation = async (documentId: string, conversationId?: string) => {
  const db = getDatabase();
  if (conversationId) {
    const existing = await db.query('SELECT id FROM conversations WHERE id=$1', [conversationId]);
    if (existing.rowCount) return conversationId;
  }

  const id = conversationId || uuidv4();
  await db.query('INSERT INTO conversations (id, document_ids) VALUES ($1, $2)', [id, [documentId]]);
  return id;
};

export const loadConversationHistory = async (conversationId: string, limit = 8): Promise<ChatTurn[]> => {
  const db = getDatabase();
  const result = await db.query(
    `SELECT role, content FROM messages
     WHERE conversation_id=$1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, Math.max(2, limit)]
  );
  return (result.rows as ChatTurn[]).reverse().filter((row) => row.role === 'user' || row.role === 'assistant');
};

export const appendConversationTurn = async (
  conversationId: string,
  userContent: string,
  assistantContent: string,
  sources?: Array<{ documentId?: string; pageNumber?: number; chunkId?: string; sourceText?: string }>
) => {
  const db = getDatabase();
  const userId = uuidv4();
  const assistantId = uuidv4();
  await db.query('INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)', [
    userId,
    conversationId,
    'user',
    userContent
  ]);
  await db.query('INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)', [
    assistantId,
    conversationId,
    'assistant',
    assistantContent
  ]);

  for (const source of sources || []) {
    const sourceDocumentId = source.documentId;
    if (!sourceDocumentId) continue;
    await db.query(
      'INSERT INTO message_sources (id, message_id, document_id, page_number, chunk_id, source_text) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        uuidv4(),
        assistantId,
        sourceDocumentId,
        source.pageNumber ?? null,
        source.chunkId || null,
        source.sourceText || (source.pageNumber != null ? `Page ${source.pageNumber}` : null)
      ]
    );
  }

  return { userId, assistantId };
};

export const clearConversationMessages = async (conversationId: string) => {
  const db = getDatabase();
  await db.query('DELETE FROM messages WHERE conversation_id=$1', [conversationId]);
};
