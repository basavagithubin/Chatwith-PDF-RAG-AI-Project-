import { getDatabase } from '../utils/database.utils.js';
import {
  detectExactIntent,
  extractBestList,
  formatListAnswer,
  formatSlokaAnswer,
  foldDiacritics,
  type ExactIntent,
  type ExtractedList
} from './exact.extract.js';
import { detectChapterRequest } from './chapter.intent.js';

const topicTerms = (intent: ExactIntent) =>
  Array.from(
    new Set(
      intent.topic
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3)
    )
  ).slice(0, 8);

const headingFromPage = (text: string) => {
  const line = text.split(/\n+/).map((part) => part.trim()).find(Boolean) || '';
  return foldDiacritics(line.slice(0, 120));
};

const scorePage = (text: string, intent: ExactIntent, extracted: ExtractedList | null) => {
  const lower = foldDiacritics(text);
  const heading = foldDiacritics(extracted?.heading || headingFromPage(text));
  const terms = topicTerms(intent);
  let score = extracted ? 12 + extracted.items.length * 3 : 0;
  for (const term of terms) {
    const folded = foldDiacritics(term);
    if (heading.includes(folded)) score += 22;
    else if (lower.includes(folded)) score += 6;
    else score -= 8;
  }
  if (/contents|at a glance|author'?s profile/.test(heading)) score -= 30;
  if (/contents\s+introduction|at a glance/i.test(text) && text.length < 1400) score -= 20;
  if (extracted?.items[0]?.n && extracted.items[0].n !== 1) score -= 28;
  if (extracted?.items.some((item) => item.sanskrit)) score += 10;
  if (intent.type === 'list' && intent.expectedCount && extracted?.items.length === intent.expectedCount) {
    score += 20;
  }
  if (extracted?.sloka?.verse) score += 6;
  return score;
};

export const tryExactDocumentAnswer = async (documentId: string, query: string) => {
  if (detectChapterRequest(query)) return null;

  const intent = detectExactIntent(query);
  if (!intent) return null;

  const terms = topicTerms(intent);
  if (!terms.length) return null;

  const conditions = terms.map((_, index) => `text ILIKE $${index + 2}`);
  const result = await getDatabase().query(
    `SELECT page_number, text
     FROM document_pages
     WHERE document_id = $1
       AND (${conditions.join(' OR ')})
     ORDER BY page_number ASC
     LIMIT 16`,
    [documentId, ...terms.map((term) => `%${term}%`)]
  );

  const ranked = (result.rows as Array<{ page_number: number; text: string | null }>)
    .map((row) => {
      const text = row.text || '';
      const extracted = extractBestList(text, intent, row.page_number);
      return {
        pageNumber: row.page_number,
        extracted,
        score: scorePage(text, intent, extracted)
      };
    })
    .filter((row) => row.extracted && row.extracted.items.length >= 2)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best?.extracted) return null;
  if (intent.type === 'list' && intent.expectedCount) {
    if (best.extracted.items[0]?.n !== 1) return null;
    if (best.extracted.items.length < Math.max(3, intent.expectedCount - 1)) return null;
  }

  const answer =
    intent.type === 'sloka'
      ? formatSlokaAnswer(best.extracted, intent)
      : formatListAnswer(best.extracted, intent);

  return {
    type: 'TEXT_RESPONSE' as const,
    intent: intent.type === 'sloka' ? 'SLOKA_ANSWER' : 'EXACT_LIST',
    answer,
    sources: [
      {
        documentId,
        pageNumber: best.pageNumber,
        sourceText: `Page ${best.pageNumber}`
      }
    ]
  };
};
