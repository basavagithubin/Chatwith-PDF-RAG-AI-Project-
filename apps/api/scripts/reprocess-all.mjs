#!/usr/bin/env node
/**
 * Rebuild every document (extract -> chunk -> embed) and wait until all are ready.
 *
 * Run this after switching embedding providers (e.g. adding an OPENAI_API_KEY),
 * because embeddings written by one provider are meaningless to another.
 *
 * Usage:
 *   node apps/api/scripts/reprocess-all.mjs
 *   npm run reprocess:all --workspace=pdf-chat-ai-api
 */

const API_BASE = (process.env.API_BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const POLL_INTERVAL_MS = Number(process.env.REPROCESS_POLL_MS || 3000);
const TIMEOUT_MS = Number(process.env.REPROCESS_TIMEOUT_MS || 20 * 60 * 1000);

const TERMINAL_OK = ['ready', 'complete', 'completed', 'indexed'];
const TERMINAL_BAD = ['failed', 'error', 'cancelled', 'canceled'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 200)}`);
  return body;
};

const classify = (status) => {
  const value = String(status || '').toLowerCase();
  if (TERMINAL_OK.some((s) => value.includes(s))) return 'ok';
  if (TERMINAL_BAD.some((s) => value.includes(s))) return 'bad';
  return 'pending';
};

const main = async () => {
  const health = await fetchJson(`${API_BASE}/health`);
  const providers = health?.providers || {};
  console.log(`API providers: llm=${providers.llm}, embedding=${providers.embedding}`);
  if (providers.embedding === 'mock') {
    console.warn('Warning: embedding provider is "mock". Set OPENAI_API_KEY and restart the API for real embeddings.');
  }

  const listed = await fetchJson(`${API_BASE}/api/documents`);
  const documents = Array.isArray(listed) ? listed : listed?.documents || [];
  if (!documents.length) {
    console.error('No documents found. Upload a PDF first.');
    process.exit(1);
  }

  const missingSource = documents.filter((doc) => doc.sourceAvailable === false);
  const reprocessable = documents.filter((doc) => doc.sourceAvailable !== false);

  if (missingSource.length) {
    console.warn(
      `\nSkipping ${missingSource.length} document(s) whose original PDF is no longer in storage:\n` +
        missingSource.map((doc) => `  - ${doc.name || doc.id}`).join('\n') +
        '\nRe-upload these PDFs to rebuild their embeddings.'
    );
  }

  if (!reprocessable.length) {
    console.error('\nNo documents have their source PDF available. Nothing to reprocess.');
    process.exit(1);
  }

  console.log(`\nReprocessing ${reprocessable.length} document(s)...`);
  for (const doc of reprocessable) {
    await fetchJson(`${API_BASE}/api/documents/${doc.id}/reprocess`, { method: 'POST' });
    console.log(`  queued ${doc.name || doc.id}`);
  }

  const deadline = Date.now() + TIMEOUT_MS;
  const pending = new Map(reprocessable.map((doc) => [doc.id, doc.name || doc.id]));
  const failed = [];

  while (pending.size && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    for (const [id, name] of [...pending]) {
      const { status } = await fetchJson(`${API_BASE}/api/documents/${id}/status`);
      const state = classify(status);
      if (state === 'pending') continue;

      pending.delete(id);
      if (state === 'bad') failed.push({ name, status });
      console.log(`  ${state === 'ok' ? 'done' : 'FAILED'} ${name} (${status})`);
    }

    if (pending.size) console.log(`  waiting on ${pending.size} document(s)...`);
  }

  if (pending.size) {
    console.error(`Timed out waiting for: ${[...pending.values()].join(', ')}`);
    process.exit(1);
  }
  if (failed.length) {
    console.error(`Failed: ${failed.map((f) => `${f.name} (${f.status})`).join(', ')}`);
    process.exit(1);
  }

  console.log('\nAll documents reprocessed. Next: npm run eval:accuracy --workspace=pdf-chat-ai-api');
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
