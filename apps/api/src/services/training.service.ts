import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../utils/database.utils.js';
import { resolveEmbeddingProviderName, resolveLLMProviderName } from '../ai/provider.config.js';

export type TrainingEventType = 'search' | 'edit' | 'regenerate' | 'accepted' | 'eval';

export type TrainingEventInput = {
  documentId?: string;
  conversationId?: string;
  eventType: TrainingEventType;
  question?: string;
  rewrittenQuery?: string;
  answer?: string;
  previousAnswer?: string;
  pages?: number[];
  chunkIds?: string[];
  intent?: string;
  meta?: Record<string, unknown>;
};

export const logTrainingEvent = async (input: TrainingEventInput) => {
  const db = getDatabase();
  const pages = (input.pages || []).filter((page) => Number.isFinite(page));
  const chunkIds = (input.chunkIds || []).filter(Boolean);
  await db.query(
    `INSERT INTO training_events
      (id, document_id, conversation_id, event_type, question, rewritten_query, answer, previous_answer, pages, chunk_ids, intent, provider, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      uuidv4(),
      input.documentId || null,
      input.conversationId || null,
      input.eventType,
      input.question || null,
      input.rewrittenQuery || null,
      input.answer || null,
      input.previousAnswer || null,
      pages,
      chunkIds,
      input.intent || null,
      `llm=${resolveLLMProviderName()},embedding=${resolveEmbeddingProviderName()}`,
      JSON.stringify(input.meta || {})
    ]
  );
};

export const listTrainingEvents = async (documentId?: string, limit = 200) => {
  const db = getDatabase();
  if (documentId) {
    const result = await db.query(
      `SELECT id, document_id, conversation_id, event_type, question, rewritten_query, answer, previous_answer,
              pages, chunk_ids, intent, provider, meta, created_at
       FROM training_events
       WHERE document_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [documentId, limit]
    );
    return result.rows;
  }
  const result = await db.query(
    `SELECT id, document_id, conversation_id, event_type, question, rewritten_query, answer, previous_answer,
            pages, chunk_ids, intent, provider, meta, created_at
     FROM training_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
};
