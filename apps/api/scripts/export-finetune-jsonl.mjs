#!/usr/bin/env node
/**
 * Export OpenAI-style chat JSONL for optional fine-tuning.
 *
 * Sources:
 *   - gold items that include goldAnswer
 *   - training_events of type edit / accepted / regenerate
 *
 * Hold out 20% into a .eval.jsonl file. Do not fine-tune the mock provider.
 *
 * Usage:
 *   npm run eval:finetune-export --workspace=pdf-chat-ai-api
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
const OUT_DIR = path.join(__dirname, '..', 'evals', 'finetune');
const HOLD_OUT = Math.min(0.8, Math.max(0.5, Number(process.env.FINETUNE_TRAIN_RATIO || 0.8)));

const SYSTEM = [
  'You are a precise PDF assistant for scriptural and study texts.',
  'Answer only from the provided document context.',
  'When the user asks to name, list, or enumerate items, extract the EXACT list from the source.',
  'Keep original numbering. Preserve Sanskrit / IAST terms next to their English meaning.',
  'When the question is about a sloka, verse, or mantra: quote the verse, then give the translation, then a short explanation.',
  'Do not paraphrase a numbered table into vague prose. Do not drop items.',
  'If context is insufficient, say so clearly.'
].join(' ');

const example = (question, answer, context = '(document passages retrieved for this question)') => ({
  messages: [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Context:\n${context}\n\nQuestion: ${question}\n\nWrite a precise Markdown answer from the context only.`
    },
    { role: 'assistant', content: answer }
  ]
});

const shuffle = (items) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
};

const writeJsonl = async (filePath, rows) => {
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, body ? `${body}\n` : '', 'utf8');
};

const main = async () => {
  const gold = JSON.parse(await fs.readFile(GOLD_PATH, 'utf8'));
  const rows = [];

  for (const set of gold.sets || []) {
    for (const item of set.items || []) {
      if (!item.goldAnswer?.trim()) continue;
      rows.push(example(item.question, item.goldAnswer.trim()));
      for (const paraphrase of item.paraphrases || []) {
        rows.push(example(paraphrase, item.goldAnswer.trim()));
      }
    }
  }

  let eventCount = 0;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const events = await client.query(
      `SELECT event_type, question, rewritten_query, answer, previous_answer
       FROM training_events
       WHERE event_type = ANY($1)
         AND coalesce(answer, '') <> ''
         AND length(answer) > 40
       ORDER BY created_at DESC
       LIMIT 400`,
      [['edit', 'accepted', 'regenerate', 'search']]
    );
    for (const row of events.rows) {
      const question = row.rewritten_query || row.question;
      if (!question || !row.answer) continue;
      if (row.event_type === 'search' && !row.previous_answer) continue;
      rows.push(example(question, row.answer));
      eventCount += 1;
    }
  } catch (error) {
    console.warn(`Skipping training_events (${error.message}). Exporting gold answers only.`);
  } finally {
    await client.end().catch(() => undefined);
  }

  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    const key = JSON.stringify(row.messages.slice(1));
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const shuffled = shuffle(unique);
  const split = Math.max(1, Math.floor(shuffled.length * HOLD_OUT));
  const train = shuffled.slice(0, split);
  const holdout = shuffled.slice(split);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const trainPath = path.join(OUT_DIR, 'sft-train.jsonl');
  const evalPath = path.join(OUT_DIR, 'sft-holdout.jsonl');
  await writeJsonl(trainPath, train);
  await writeJsonl(evalPath, holdout);

  const manifest = {
    generatedAt: new Date().toISOString(),
    trainExamples: train.length,
    holdoutExamples: holdout.length,
    fromGold: unique.length - eventCount,
    fromEvents: eventCount,
    note: 'Fine-tune only after real embeddings/LLM are on and eval recall is strong. Keep temperature 0–0.2. Stop if holdout drops.'
  };
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Wrote ${train.length} train + ${holdout.length} holdout examples to ${OUT_DIR}`);
  console.log(JSON.stringify(manifest, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
