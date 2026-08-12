#!/usr/bin/env node
/**
 * Portfhelio accuracy eval loop.
 *
 * Usage:
 *   node apps/api/scripts/eval-accuracy.mjs
 *   npm run eval:accuracy --workspace=pdf-chat-ai-api
 *
 * Env:
 *   API_BASE_URL   default http://127.0.0.1:5000
 *   EVAL_DOCUMENT_ID  optional — only evaluate this document
 *   EVAL_GOLD_PATH    optional — path to gold JSON
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = (process.env.API_BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const GOLD_PATH =
  process.env.EVAL_GOLD_PATH ||
  path.join(__dirname, '..', 'evals', 'gold-questions.json');

const insufficientPatterns = [
  /not enough evidence/i,
  /insufficient/i,
  /does not (appear|mention|discuss|cover|say)/i,
  /no (relevant|supporting) (context|passages|evidence)/i,
  /cannot (find|determine|answer)/i,
  /not (found|mentioned|discussed|covered) in/i,
  /outside (the|this) (document|pdf|context)/i
];

const normalize = (value) => String(value || '').toLowerCase();

const sourcePages = (result) => {
  const pages = new Set();
  for (const source of result?.sources || []) {
    if (Number.isFinite(Number(source.pageNumber))) pages.add(Number(source.pageNumber));
  }
  if (result?.graph?.pageStart && result?.graph?.pageEnd) {
    for (let p = result.graph.pageStart; p <= Math.min(result.graph.pageEnd, result.graph.pageStart + 20); p += 1) {
      pages.add(p);
    }
  }
  return [...pages];
};

const hitAtK = (retrieved, expected, k = 8) => {
  if (!expected?.length) return null;
  const top = new Set(retrieved.slice(0, k));
  const hits = expected.filter((page) => top.has(page));
  return {
    hit: hits.length > 0,
    recall: hits.length / expected.length,
    hits
  };
};

const factCoverage = (answer, keyFacts, minKeyFacts = 1) => {
  if (!keyFacts?.length) return { score: 1, matched: [], required: 0 };
  const text = normalize(answer);
  const matched = keyFacts.filter((fact) => text.includes(normalize(fact)));
  const required = Math.min(minKeyFacts ?? 1, keyFacts.length);
  return {
    score: required === 0 ? 1 : matched.length >= required ? 1 : matched.length / required,
    matched,
    required
  };
};

const hallucinationOk = (answer, requireInsufficient) => {
  if (!requireInsufficient) return null;
  const text = String(answer || '');
  return insufficientPatterns.some((pattern) => pattern.test(text));
};

const pickGoldSet = (sets, documentName) => {
  const name = normalize(documentName);
  for (const set of sets) {
    const needles = set.nameContains || [];
    if (needles.includes('*')) continue;
    if (needles.some((needle) => name.includes(normalize(needle)))) return set;
  }
  return sets.find((set) => (set.nameContains || []).includes('*')) || null;
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status} for ${url}`);
    err.body = body;
    throw err;
  }
  return body;
};

const evaluateItem = async (documentId, item) => {
  const started = Date.now();
  const result = await fetchJson(`${API_BASE}/api/documents/${documentId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: item.question })
  });

  const answer = result?.answer || '';
  const pages = sourcePages(result);
  const retrieval = hitAtK(pages, item.expectedPages, 8);
  const facts = factCoverage(answer, item.keyFacts, item.minKeyFacts);
  const noHallucination = hallucinationOk(answer, item.requireInsufficient);

  const checks = [];
  if (retrieval) checks.push(retrieval.hit ? 1 : 0);
  if (item.keyFacts?.length) checks.push(facts.score >= 1 ? 1 : facts.score);
  if (item.requireInsufficient) checks.push(noHallucination ? 1 : 0);
  if (!checks.length) checks.push(answer.trim().length > 40 ? 1 : 0);

  const score = checks.reduce((a, b) => a + b, 0) / checks.length;

  return {
    id: item.id,
    question: item.question,
    intent: item.intent,
    responseIntent: result?.intent || null,
    responseType: result?.type || null,
    score,
    retrieval,
    facts,
    noHallucination,
    pages,
    latencyMs: Date.now() - started,
    answerPreview: String(answer).replace(/\s+/g, ' ').slice(0, 220)
  };
};

const main = async () => {
  const gold = JSON.parse(await fs.readFile(GOLD_PATH, 'utf8'));
  const documents = await fetchJson(`${API_BASE}/api/documents`);
  const list = Array.isArray(documents) ? documents : documents?.documents || [];
  const ready = list.filter((doc) => {
    if (process.env.EVAL_DOCUMENT_ID && doc.id !== process.env.EVAL_DOCUMENT_ID) return false;
    const status = normalize(doc.status || doc.processing_status || '');
    return !status || status.includes('ready') || status.includes('complete') || status.includes('indexed');
  });

  if (!ready.length) {
    console.error('No ready documents found. Upload/process a PDF and ensure the API is running.');
    process.exit(1);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    documents: [],
    summary: { items: 0, avgScore: 0, retrievalHits: 0, retrievalTotal: 0, factPass: 0, factTotal: 0, hallucinationPass: 0, hallucinationTotal: 0 }
  };

  for (const doc of ready) {
    const set = pickGoldSet(gold.sets || [], doc.name || doc.filename || '');
    if (!set) continue;

    const docReport = {
      documentId: doc.id,
      documentName: doc.name || doc.filename,
      goldSetId: set.id,
      results: []
    };

    console.log(`\nEvaluating ${docReport.documentName} (${doc.id}) with set ${set.id}`);

    for (const item of set.items || []) {
      try {
        const row = await evaluateItem(doc.id, item);
        docReport.results.push(row);
        report.summary.items += 1;
        report.summary.avgScore += row.score;
        if (row.retrieval) {
          report.summary.retrievalTotal += 1;
          if (row.retrieval.hit) report.summary.retrievalHits += 1;
        }
        if (item.keyFacts?.length) {
          report.summary.factTotal += 1;
          if (row.facts.score >= 1) report.summary.factPass += 1;
        }
        if (item.requireInsufficient) {
          report.summary.hallucinationTotal += 1;
          if (row.noHallucination) report.summary.hallucinationPass += 1;
        }
        console.log(
          `  [${row.score.toFixed(2)}] ${item.id} · pages=${row.pages.slice(0, 6).join(',') || '-'} · ${row.answerPreview.slice(0, 80)}…`
        );
      } catch (error) {
        console.error(`  FAIL ${item.id}:`, error.message);
        docReport.results.push({ id: item.id, score: 0, error: error.message });
        report.summary.items += 1;
      }
    }

    report.documents.push(docReport);
  }

  if (report.summary.items) {
    report.summary.avgScore = Number((report.summary.avgScore / report.summary.items).toFixed(3));
  }
  report.summary.retrievalHitRate = report.summary.retrievalTotal
    ? Number((report.summary.retrievalHits / report.summary.retrievalTotal).toFixed(3))
    : null;
  report.summary.factCoverageRate = report.summary.factTotal
    ? Number((report.summary.factPass / report.summary.factTotal).toFixed(3))
    : null;
  report.summary.noHallucinationRate = report.summary.hallucinationTotal
    ? Number((report.summary.hallucinationPass / report.summary.hallucinationTotal).toFixed(3))
    : null;

  const outDir = path.join(__dirname, '..', 'evals', 'reports');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `eval-${stamp}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== Accuracy summary ===');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report written to ${outPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
