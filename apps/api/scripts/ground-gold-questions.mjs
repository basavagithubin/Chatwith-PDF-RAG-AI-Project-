#!/usr/bin/env node
/**
 * Derive gold-question `expectedPages` from the raw document text.
 *
 * Ground truth must come from the source PDF text, never from the retrieval
 * pipeline, otherwise the eval would be scoring retrieval against itself.
 *
 * Usage:
 *   node apps/api/scripts/ground-gold-questions.mjs           # write changes
 *   node apps/api/scripts/ground-gold-questions.mjs --dry-run # preview only
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
const MAX_PAGES = Number(process.env.GROUND_MAX_PAGES || 12);

const normalize = (value) => String(value || '').toLowerCase();

const matchesDocument = (set, documentName) => {
  const name = normalize(documentName);
  const needles = set.nameContains || [];
  if (needles.includes('*')) return false;
  return needles.some((needle) => name.includes(normalize(needle)));
};

const occurrences = (text, term) => text.split(term).length - 1;

/** Pages whose raw text satisfies the item's ground-truth terms. */
const findPages = (pages, terms, mode) => {
  const wanted = terms.map(normalize).filter(Boolean);
  if (!wanted.length) return [];

  const scored = [];
  for (const page of pages) {
    const text = normalize(page.text);
    if (!text) continue;

    const matchedTerms = wanted.filter((term) => text.includes(term));
    const satisfied = mode === 'all' ? matchedTerms.length === wanted.length : matchedTerms.length > 0;
    if (!satisfied) continue;

    // Rank by term coverage first, then by how densely the terms appear.
    const density = wanted.reduce((sum, term) => sum + occurrences(text, term), 0);
    scored.push({ page: page.page_number, coverage: matchedTerms.length, density });
  }

  return scored
    .sort((a, b) => b.coverage - a.coverage || b.density - a.density || a.page - b.page)
    .slice(0, MAX_PAGES)
    .map((entry) => entry.page)
    .sort((a, b) => a - b);
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

    const pages = await client.query(
      'SELECT page_number, text FROM document_pages WHERE document_id = $1 ORDER BY page_number ASC',
      [doc.id]
    );

    console.log(`\nSet "${set.id}" -> ${doc.name} (${pages.rowCount} pages)`);

    for (const item of set.items || []) {
      if (!item.groundTruthTerms?.length) continue;

      const resolved = findPages(pages.rows, item.groundTruthTerms, item.groundTruthMode || 'any');
      if (!resolved.length) {
        console.log(`  ! ${item.id}: no pages matched ${JSON.stringify(item.groundTruthTerms)}`);
        continue;
      }

      const before = item.expectedPages || [];
      const same = before.length === resolved.length && before.every((page, i) => page === resolved[i]);
      item.expectedPages = resolved;

      console.log(`  ${same ? '=' : '~'} ${item.id}: pages ${resolved.join(', ')}`);
      if (!same) changes.push({ item: item.id, before, after: resolved });
    }
  }

  await client.end();

  if (!changes.length) {
    console.log('\nNo expectedPages changes needed.');
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
