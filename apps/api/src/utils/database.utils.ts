import { Pool } from 'pg';
import '../config/env.js';

let pool: Pool;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const initDatabase = async () => {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 1)
  });

  const schemaSql = `
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS documents (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      size bigint NOT NULL,
      checksum text,
      status text NOT NULL,
      page_count int,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id uuid PRIMARY KEY,
      document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
      checksum text NOT NULL,
      chunk_count int NOT NULL,
      uploaded_chunks int NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS document_pages (
      id uuid PRIMARY KEY,
      document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
      page_number int NOT NULL,
      text text,
      word_count int,
      processing_status text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS document_chunks (
      id uuid PRIMARY KEY,
      document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
      page_number int NOT NULL,
      chunk_index int NOT NULL,
      content text NOT NULL,
      token_count int NOT NULL,
      section text,
      created_at timestamptz DEFAULT now(),
      UNIQUE(document_id, page_number, chunk_index)
    );
    CREATE TABLE IF NOT EXISTS document_embeddings (
      id uuid PRIMARY KEY,
      document_chunk_id uuid REFERENCES document_chunks(id) ON DELETE CASCADE UNIQUE,
      embedding vector(1536) NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS processing_jobs (
      id uuid PRIMARY KEY,
      document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
      stage text NOT NULL,
      progress int NOT NULL DEFAULT 0,
      error_code text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS processing_errors (
      id uuid PRIMARY KEY,
      document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
      page_number int,
      error text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id uuid PRIMARY KEY,
      document_ids uuid[] NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id uuid PRIMARY KEY,
      conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS message_sources (
      id uuid PRIMARY KEY,
      message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
      document_id uuid NOT NULL,
      page_number int,
      chunk_id uuid,
      source_text text
    );
    CREATE TABLE IF NOT EXISTS training_events (
      id uuid PRIMARY KEY,
      document_id uuid,
      conversation_id uuid,
      event_type text NOT NULL,
      question text,
      rewritten_query text,
      answer text,
      previous_answer text,
      pages int[],
      chunk_ids text[],
      intent text,
      provider text,
      meta jsonb,
      created_at timestamptz DEFAULT now()
    );
  `;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await pool.query(schemaSql);
      break;
    } catch (error) {
      if (attempt === 10) throw error;
      await sleep(1000);
    }
  }

  // PGlite does not always materialise the inline UNIQUE on document_chunk_id, and
  // `ON CONFLICT (document_chunk_id)` needs an inferable unique index to exist.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS document_embeddings_chunk_key
    ON document_embeddings (document_chunk_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS training_events_document_idx
    ON training_events (document_id, created_at DESC)
  `);

  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS document_embeddings_embedding_idx
      ON document_embeddings USING ivfflat (embedding vector_l2_ops) WITH (lists = 100)
    `);
  } catch {
    // IVFFlat is unavailable in embedded Postgres runtimes such as PGlite.
  }
};

export const getDatabase = () => {
  if (!pool) throw new Error('Database not initialized');
  return pool;
};
