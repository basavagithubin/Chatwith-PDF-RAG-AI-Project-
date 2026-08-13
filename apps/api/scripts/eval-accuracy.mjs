#!/usr/bin/env node
/**
 * PDFChat accuracy eval loop.
 *
 * Usage:
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

const SAVE_BASELINE = process.argv.includes('--save-baseline');
const COMPARED_METRICS = [
  'avgScore',
  'retrievalHitRate',
  'retrievalRecall',
  'factCoverageRate',
  'noHallucinationRate',
  'mustIncludeRate',
  'mustExcludeRate',
  'listCompletenessRate',
  'sectionCoverageRate',
  'chunkHitRate'
];

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

const readBaseline = async (baselinePath) => {
  try {
    return JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  } catch {
    return null;
  }
};

const formatDelta = (before, after) => {
  if (before == null || after == null) return `${before ?? 'n/a'} -> ${after ?? 'n/a'}`;
  const delta = after - before;
  const sign = delta > 0 ? '+' : '';
  return `${before} -> ${after} (${sign}${delta.toFixed(3)})`;
};

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
  const pageMentions = String(result?.answer || '').matchAll(/\b(?:p(?:age)?\.?\s*)(\d{1,3})\b/gi);
  for (const match of pageMentions) pages.add(Number(match[1]));
  return [...pages];
};

const sourceChunkIds = (result) =>
  (result?.sources || []).map((source) => source.chunkId).filter(Boolean);

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

const phraseCoverage = (answer, phrases, mode) => {
  if (!phrases?.length) return null;
  const text = normalize(answer);
  const matched = phrases.filter((phrase) => text.includes(normalize(phrase)));
  if (mode === 'exclude') {
    return { score: matched.length ? 0 : 1, matched, required: 0 };
  }
  return {
    score: matched.length === phrases.length ? 1 : matched.length / phrases.length,
    matched,
    required: phrases.length
  };
};

const countListItems = (answer) => {
  const numbered = new Set();
  for (const match of String(answer || '').matchAll(/^\s*(\d{1,2})[.)]\s+\S+/gm)) {
    numbered.add(Number(match[1]));
  }
  if (numbered.size) return numbered.size;
  const bullets = String(answer || '').match(/^\s*[-*]\s+\S+/gm) || [];
  return bullets.length;
};

const listCompleteness = (answer, requiredItemCount) => {
  if (!requiredItemCount) return null;
  const count = countListItems(answer);
  return {
    score: count >= requiredItemCount ? 1 : count / requiredItemCount,
    count,
    required: requiredItemCount
  };
};

const sectionCoverage = (answer, requiredSections) => {
  if (!requiredSections?.length) return null;
  const text = normalize(answer);
  const matched = requiredSections.filter((section) => text.includes(normalize(section)));
  return {
    score: matched.length === requiredSections.length ? 1 : matched.length / requiredSections.length,
    matched,
    required: requiredSections.length
  };
};

const chunkHit = (retrievedIds, expectedIds) => {
  if (!expectedIds?.length) return null;
  const set = new Set(retrievedIds);
  const hits = expectedIds.filter((id) => set.has(id));
  return {
    hit: hits.length > 0,
    recall: hits.length / expectedIds.length,
    hits
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

const expandItems = (items) => {
  const expanded = [];
  for (const item of items || []) {
    expanded.push(item);
    for (const [index, question] of (item.paraphrases || []).entries()) {
      if (!question?.trim()) continue;
      expanded.push({
        ...item,
        id: `${item.id}__p${index + 1}`,
        question: question.trim(),
        paraphrases: undefined,
        history: item.history
      });
    }
  }
  return expanded;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url, options = {}, attempt = 1) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (response.status === 429 && attempt <= 4) {
    const waitSec = Number(body?.retryAfter || response.headers.get('Retry-After') || 15);
    await sleep(Math.max(1, waitSec) * 1000);
    return fetchJson(url, options, attempt + 1);
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
    headers: { 'Content-Type': 'application/json', 'X-Eval-Run': '1' },
    body: JSON.stringify({
      query: item.question,
      history: item.history || [],
      persist: false,
      source: 'eval'
    })
  });

  const answer = result?.answer || '';
  const pages = sourcePages(result);
  const retrieval = hitAtK(pages, item.expectedPages, 8);
  const facts = factCoverage(answer, item.keyFacts, item.minKeyFacts);
  const mustInclude = phraseCoverage(answer, item.mustInclude, 'include');
  const mustExclude = phraseCoverage(answer, item.mustExclude, 'exclude');
  const list = listCompleteness(answer, item.requiredItemCount);
  const sections = sectionCoverage(answer, item.requiredSections);
  const chunks = chunkHit(sourceChunkIds(result), item.expectedChunkIds);
  const noHallucination = hallucinationOk(answer, item.requireInsufficient);

  const checks = [];
  if (retrieval) checks.push(retrieval.hit ? 1 : 0);
  if (item.keyFacts?.length) checks.push(facts.score >= 1 ? 1 : facts.score);
  if (mustInclude) checks.push(mustInclude.score);
  if (mustExclude) checks.push(mustExclude.score);
  if (list) checks.push(list.score);
  if (sections) checks.push(sections.score);
  if (chunks) checks.push(chunks.hit ? 1 : 0);
  if (item.requireInsufficient) checks.push(noHallucination ? 1 : 0);
  if (!checks.length) checks.push(answer.trim().length > 40 ? 1 : 0);

  const score = checks.reduce((a, b) => a + b, 0) / checks.length;

  return {
    id: item.id,
    question: item.question,
    intent: item.intent,
    responseIntent: result?.intent || null,
    responseType: result?.type || null,
    rewrittenQuery: result?.meta?.rewrittenQuery || null,
    score,
    retrieval,
    facts,
    mustInclude,
    mustExclude,
    list,
    sections,
    chunks,
    noHallucination,
    pages,
    latencyMs: Date.now() - started,
    answerPreview: String(answer).replace(/\s+/g, ' ').slice(0, 220)
  };
};

const bump = (summary, key, passed, applicable) => {
  if (!applicable) return;
  summary[`${key}Total`] += 1;
  if (passed) summary[`${key}Pass`] += 1;
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

  const health = await fetchJson(`${API_BASE}/health`).catch(() => null);
  const providers = health?.providers || null;

  const report = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    goldVersion: gold.version || null,
    provider: providers ? `llm=${providers.llm}, embedding=${providers.embedding}` : 'unknown',
    providers,
    documents: [],
    summary: {
      items: 0,
      avgScore: 0,
      retrievalHits: 0,
      retrievalTotal: 0,
      retrievalRecallSum: 0,
      factPass: 0,
      factTotal: 0,
      hallucinationPass: 0,
      hallucinationTotal: 0,
      mustIncludePass: 0,
      mustIncludeTotal: 0,
      mustExcludePass: 0,
      mustExcludeTotal: 0,
      listPass: 0,
      listTotal: 0,
      sectionPass: 0,
      sectionTotal: 0,
      chunkPass: 0,
      chunkTotal: 0
    }
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

    const items = expandItems(set.items || []);
    console.log(`\nEvaluating ${docReport.documentName} (${doc.id}) with set ${set.id} (${items.length} items)`);

    for (const item of items) {
      try {
        const row = await evaluateItem(doc.id, item);
        docReport.results.push(row);
        report.summary.items += 1;
        report.summary.avgScore += row.score;
        if (row.retrieval) {
          report.summary.retrievalTotal += 1;
          report.summary.retrievalRecallSum += row.retrieval.recall;
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
        bump(report.summary, 'mustInclude', (row.mustInclude?.score ?? 1) >= 1, Boolean(row.mustInclude));
        bump(report.summary, 'mustExclude', (row.mustExclude?.score ?? 1) >= 1, Boolean(row.mustExclude));
        bump(report.summary, 'list', (row.list?.score ?? 1) >= 1, Boolean(row.list));
        bump(report.summary, 'section', (row.sections?.score ?? 1) >= 1, Boolean(row.sections));
        bump(report.summary, 'chunk', Boolean(row.chunks?.hit), Boolean(row.chunks));
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
  report.summary.retrievalRecall = report.summary.retrievalTotal
    ? Number((report.summary.retrievalRecallSum / report.summary.retrievalTotal).toFixed(3))
    : null;
  delete report.summary.retrievalRecallSum;
  report.summary.factCoverageRate = report.summary.factTotal
    ? Number((report.summary.factPass / report.summary.factTotal).toFixed(3))
    : null;
  report.summary.noHallucinationRate = report.summary.hallucinationTotal
    ? Number((report.summary.hallucinationPass / report.summary.hallucinationTotal).toFixed(3))
    : null;
  report.summary.mustIncludeRate = report.summary.mustIncludeTotal
    ? Number((report.summary.mustIncludePass / report.summary.mustIncludeTotal).toFixed(3))
    : null;
  report.summary.mustExcludeRate = report.summary.mustExcludeTotal
    ? Number((report.summary.mustExcludePass / report.summary.mustExcludeTotal).toFixed(3))
    : null;
  report.summary.listCompletenessRate = report.summary.listTotal
    ? Number((report.summary.listPass / report.summary.listTotal).toFixed(3))
    : null;
  report.summary.sectionCoverageRate = report.summary.sectionTotal
    ? Number((report.summary.sectionPass / report.summary.sectionTotal).toFixed(3))
    : null;
  report.summary.chunkHitRate = report.summary.chunkTotal
    ? Number((report.summary.chunkPass / report.summary.chunkTotal).toFixed(3))
    : null;

  const outDir = path.join(__dirname, '..', 'evals', 'reports');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `eval-${stamp}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

  const providerTag = String(providers?.embedding || 'unknown').replace(/[^\w-]+/g, '');
  const providerPath = path.join(outDir, `provider-${providerTag || 'unknown'}.json`);
  await fs.writeFile(providerPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== Accuracy summary ===');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`provider: ${report.provider}`);

  const baselinePath = path.join(outDir, 'baseline.json');
  const baseline = await readBaseline(baselinePath);
  if (baseline) {
    console.log('\n=== Change vs baseline ===');
    console.log(`baseline taken ${baseline.generatedAt} (provider: ${baseline.provider || 'unknown'})`);
    for (const metric of COMPARED_METRICS) {
      console.log(`  ${metric}: ${formatDelta(baseline.summary?.[metric], report.summary[metric])}`);
    }
  }

  if (SAVE_BASELINE) {
    await fs.writeFile(baselinePath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nBaseline updated at ${baselinePath}`);
  } else if (!baseline) {
    console.log('\nNo baseline recorded yet. Run with --save-baseline to freeze this run as the comparison point.');
  }

  console.log(`Report written to ${outPath}`);
  console.log(`Provider snapshot: ${providerPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
