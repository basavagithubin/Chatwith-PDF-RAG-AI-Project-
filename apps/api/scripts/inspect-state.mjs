#!/usr/bin/env node
/** Quick data-state inspection: per-document pages/chunks/embeddings counts. */
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const result = await client.query(`
  SELECT d.id, d.name, d.status, d.page_count,
    (SELECT count(*) FROM document_pages WHERE document_id = d.id) AS pages,
    (SELECT count(*) FROM document_chunks WHERE document_id = d.id) AS chunks,
    (SELECT count(*) FROM document_embeddings e
       JOIN document_chunks ch ON ch.id = e.document_chunk_id
      WHERE ch.document_id = d.id) AS embeddings
  FROM documents d
  ORDER BY d.created_at DESC
`);
console.table(result.rows);

const errors = await client.query(
  'SELECT document_id, page_number, error FROM processing_errors ORDER BY created_at DESC LIMIT 10'
);
if (errors.rowCount) {
  console.log('\nRecent processing errors:');
  console.table(errors.rows);
}

const constraints = await client.query(`
  SELECT conname, contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'document_embeddings'::regclass
`);
console.log('\ndocument_embeddings constraints:');
console.table(constraints.rows);

await client.end();
