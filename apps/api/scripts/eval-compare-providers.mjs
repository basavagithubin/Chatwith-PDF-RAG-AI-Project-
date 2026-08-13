#!/usr/bin/env node
/**
 * Compare mock-hash embeddings vs a real embedding/LLM provider.
 *
 * 1. Reads /health to see the live provider.
 * 2. Runs eval:accuracy (unless --skip-eval).
 * 3. Diffs evals/reports/provider-mock.json vs provider-openai.json (or the latest run).
 *
 * To measure real embeddings:
 *   1. Set OPENAI_API_KEY (or LLM_PROVIDER=openai + EMBEDDING_PROVIDER=openai)
 *   2. Restart the API
 *   3. npm run reprocess:all --workspace=pdf-chat-ai-api
 *   4. npm run eval:compare --workspace=pdf-chat-ai-api
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = (process.env.API_BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const SKIP_EVAL = process.argv.includes('--skip-eval');
const REPORT_DIR = path.join(__dirname, '..', 'evals', 'reports');
const METRICS = [
  'avgScore',
  'retrievalHitRate',
  'retrievalRecall',
  'factCoverageRate',
  'noHallucinationRate',
  'mustIncludeRate',
  'mustExcludeRate',
  'listCompletenessRate',
  'sectionCoverageRate'
];

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
};

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const runEval = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'eval-accuracy.mjs')], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`eval:accuracy exited ${code}`))));
  });

const formatDelta = (before, after) => {
  if (before == null || after == null) return `${before ?? 'n/a'} -> ${after ?? 'n/a'}`;
  const delta = after - before;
  const sign = delta > 0 ? '+' : '';
  return `${before} -> ${after} (${sign}${Number(delta).toFixed(3)})`;
};

const main = async () => {
  const health = await fetchJson(`${API_BASE}/health`);
  const providers = health?.providers || {};
  console.log(`Live providers: llm=${providers.llm}, embedding=${providers.embedding}`);

  if (providers.embedding === 'mock' || providers.llm === 'mock') {
    console.warn(
      [
        '',
        'Real embeddings/LLM are NOT active. Mock hash vectors cannot be trained.',
        'Enable a real model, then rebuild vectors:',
        '  1. Set OPENAI_API_KEY in .env (20+ chars, not a placeholder)',
        '  2. Leave LLM_PROVIDER=auto and EMBEDDING_PROVIDER=auto',
        '  3. Restart the API (npm run dev:local)',
        '  4. npm run reprocess:all --workspace=pdf-chat-ai-api',
        '  5. Re-run npm run eval:compare --workspace=pdf-chat-ai-api',
        ''
      ].join('\n')
    );
  }

  if (!SKIP_EVAL) {
    await runEval();
  }

  const mockReport = await readJson(path.join(REPORT_DIR, 'provider-mock.json'));
  const openaiReport = await readJson(path.join(REPORT_DIR, 'provider-openai.json'));
  const currentTag = String(providers.embedding || 'unknown');
  const current = await readJson(path.join(REPORT_DIR, `provider-${currentTag}.json`));

  const left = mockReport;
  const right = openaiReport || current;
  if (!left || !right) {
    console.log('Need at least one mock snapshot and one current/openai snapshot to compare.');
    console.log('After a mock eval, enable OpenAI, reprocess, and run this script again.');
    process.exit(left && right ? 0 : 0);
  }

  const comparison = {
    generatedAt: new Date().toISOString(),
    mockProvider: left.provider,
    realProvider: right.provider,
    mockGeneratedAt: left.generatedAt,
    realGeneratedAt: right.generatedAt,
    metrics: {}
  };

  console.log('\n=== Mock hash vs real embeddings/LLM ===');
  console.log(`mock: ${left.provider} (${left.generatedAt})`);
  console.log(`real: ${right.provider} (${right.generatedAt})`);
  for (const metric of METRICS) {
    comparison.metrics[metric] = {
      mock: left.summary?.[metric] ?? null,
      real: right.summary?.[metric] ?? null
    };
    console.log(`  ${metric}: ${formatDelta(left.summary?.[metric], right.summary?.[metric])}`);
  }

  const outPath = path.join(REPORT_DIR, 'provider-compare.json');
  await fs.writeFile(outPath, JSON.stringify(comparison, null, 2), 'utf8');
  console.log(`\nWrote ${outPath}`);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
