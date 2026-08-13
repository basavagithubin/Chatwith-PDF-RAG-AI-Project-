#!/usr/bin/env node
/**
 * Attach expectedChunkIds to gold items from document_chunks (not from retrieval).
 *
 * Usage:
 *   npm run eval:ground-chunks --workspace=pdf-chat-ai-api
 *   node apps/api/scripts/ground-gold-chunks.mjs --dry-run
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const GOLD_PATH = process.env.EVAL_GOLD_PATH || path.join(__dirname, '..', 'evals', 'gold-questions.json');
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_CHUNKS = Number(process.env.GROUND_MAX_CHUNKS || 8);

const normalize = (value) => String(value || '').toLowerCase();

const matchesDocument = (set, documentName) => {
  const name = normalize(documentName);
  const needles = set.nameContains || [];
  if (needles.includes('*')) return false;
  return needles.some((needle) => name.includes(normalize(needle)));
};

const main = async () => {
  const gold = JSON.parse(await fs.readFile(GOLD_PATH, 'utf8'));
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const documents = await client.query('SELECT id, name FROM documents ORDER BY created_at DESC');
  const changes = [];

  for (const set of gold.sets || []) {
    const doc = documents.rows.find((row) => matchesDocument(set, row.name));
    if (!doc) {
      console.log(`Skipping set "${set.id}" — no matching document loaded.`);
      continue;
    }

    const chunks = await client.query(
      'SELECT id, page_number, content FROM document_chunks WHERE document_id=$1 ORDER BY page_number, chunk_index',
      [doc.id]
    );
    console.log(`\nSet "${set.id}" -> ${doc.name} (${chunks.rowCount} chunks)`);

    for (const item of set.items || []) {
      const terms = (item.groundTruthTerms || []).map(normalize).filter(Boolean);
      if (!terms.length) continue;

      const ranked = chunks.rows
        .map((chunk) => {
          const text = normalize(chunk.content);
          const hits = terms.filter((term) => text.includes(term)).length;
          return { id: chunk.id, page: chunk.page_number, hits };
        })
        .filter((row) => row.hits > 0)
        .sort((a, b) => b.hits - a.hits || a.page - b.page)
        .slice(0, MAX_CHUNKS);

      if (!ranked.length) {
        console.log(`  ! ${item.id}: no chunks matched`);
        continue;
      }

      const next = ranked.map((row) => row.id);
      const before = item.expectedChunkIds || [];
      const same = before.length === next.length && before.every((id, index) => id === next[index]);
      item.expectedChunkIds = next;
      console.log(`  ${same ? '=' : '~'} ${item.id}: ${next.length} chunk(s)`);
      if (!same) changes.push(item.id);
    }
  }

  await client.end();

  if (!changes.length) {
    console.log('\nNo expectedChunkIds changes needed.');
    return;
  }
  if (DRY_RUN) {
    console.log(`\nDry run — ${changes.length} item(s) would change.`);
    return;
  }

  await fs.writeFile(GOLD_PATH, `${JSON.stringify(gold, null, 2)}\n`, 'utf8');
  console.log(`\nUpdated ${changes.length} item(s) in ${GOLD_PATH}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
