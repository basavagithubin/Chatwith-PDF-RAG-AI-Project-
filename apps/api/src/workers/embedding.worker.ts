import '../config/env.js';
import { Worker } from 'bullmq';
import { getDatabase } from '../utils/database.utils.js';
import { createEmbeddingProvider } from '../ai/embedding.provider.js';
import { toSql } from 'pgvector/pg';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

const worker = new Worker('embedding-processing', async (job) => {
  const { documentId } = job.data;
  const db = getDatabase();
  const provider = createEmbeddingProvider();

  const result = await db.query('SELECT id, content FROM document_chunks WHERE document_id=$1 ORDER BY page_number, chunk_index', [documentId]);
  for (const row of result.rows) {
    const embedding = await provider.generateEmbedding(row.content);
    await db.query(
      `INSERT INTO document_embeddings (id, document_chunk_id, embedding)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [row.id, row.id, toSql(embedding)]
    );
  }

  await db.query('UPDATE documents SET status=$2 WHERE id=$1', [documentId, 'READY']);
}, { connection: connection as any });

worker.on('failed', async (job, err) => {
  console.error('Embedding worker failed', job?.id, err);
  const documentId = job?.data?.documentId;
  if (!documentId) return;
  try {
    await getDatabase().query('UPDATE documents SET status=$2 WHERE id=$1', [documentId, 'FAILED']);
  } catch (updateError) {
    console.error('Unable to mark document as failed', updateError);
  }
});

worker.on('completed', (job) => {
  console.log('Embedding worker completed', job.id);
});
