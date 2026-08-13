import { getDatabase } from '../utils/database.utils.js';
import { createEmbeddingProvider } from '../ai/embedding.provider.js';
import { createLLMProvider } from '../ai/llm.provider.js';
import { chunkTextForStream } from '../ai/providers/mock.provider.js';
import { getConversationalReply } from '../utils/chat.utils.js';
import { tryChapterAnalysis } from './chapter.analysis.js';
import { tryChapterList } from './chapter.boundary.js';
import { tryGraphFollowUp, tryGraphGeneration } from './chapter.graph.js';
import { tryExactDocumentAnswer } from './exact.answer.js';
import { tryDeepDocumentResearch } from './deep.research.js';
import { correctQuerySpelling, SpellCheckResult } from './spellcheck.service.js';
import { expandDomainTerms } from './domain.synonyms.js';
import { rewriteQueryWithHistory, type ChatTurn } from './query.rewrite.js';
import { appendConversationTurn, ensureConversation, loadConversationHistory } from './conversation.service.js';
import { logTrainingEvent } from './training.service.js';
import { toSql } from 'pgvector/pg';

type DocumentChunkRow = {
  chunk_id: string;
  page_number: number;
  content: string;
};

type Candidate = {
  id: string;
  pageNumber: number;
  content: string;
  score?: number;
};

const ROMAN_MAP: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20
};

const STOP_WORDS = new Set([
  'give', 'me', 'detail', 'details', 'about', 'it', 'the', 'and', 'for', 'with', 'from',
  'this', 'that', 'everything', 'point', 'points', 'explain', 'please', 'tell', 'all',
  'in', 'of', 'to', 'a', 'an', 'on', 'by', 'is', 'are', 'was', 'were', 'describe', 'description',
  'what', 'can', 'you', 'could', 'how', 'why', 'name', 'list', 'enumerate', 'mention'
]);

/** Generic synonym expansion (document-agnostic). */
const GENERIC_SYNONYMS: Array<{ match: RegExp; terms: string[] }> = [
  { match: /\b(death|dying|deceased|funeral)\b/i, terms: ['death', 'deceased', 'funeral', 'rite', 'ceremony'] },
  { match: /\b(hell|afterlife|realm|loka|abode)\b/i, terms: ['hell', 'realm', 'world', 'abode', 'torment'] },
  { match: /\b(impurity|pollution|pure|purification)\b/i, terms: ['impurity', 'pure', 'purification', 'relatives'] },
  { match: /\b(rite|ceremony|ritual|sacrament)\b/i, terms: ['rite', 'ceremony', 'ritual', 'offering'] },
  { match: /\b(path|way|journey)\b/i, terms: ['path', 'way', 'journey'] },
  { match: /\b(sin|sinful|wicked|virtue)\b/i, terms: ['sin', 'sinful', 'virtue', 'conduct'] },
  { match: /\b(urge|urges|impulse|impulses)\b/i, terms: ['urge', 'urges', 'impulse', 'vegam', 'vega'] }
];

const extractChapterHints = (query: string) => {
  const hints: string[] = [];
  const roman = query.match(/\b([ivxlc]+)\s*\./i)?.[1]?.toLowerCase()
    || query.match(/\bchapter\s+([ivxlc]+)\b/i)?.[1]?.toLowerCase()
    || query.match(/^\s*([ivxlc]+)\s*$/i)?.[1]?.toLowerCase();
  if (roman && ROMAN_MAP[roman]) {
    hints.push(`${roman.toUpperCase()}.`);
    hints.push(`${roman.toUpperCase()}. `);
    hints.push(` ${ROMAN_MAP[roman]}.`);
  }

  const numbered = query.match(/\b(?:chapter|section)\s*(\d{1,2})\b/i)?.[1]
    || query.match(/^\s*(\d{1,2})\b/)?.[1]
    || query.match(/\b(\d{1,2})\s+(give|detail|everything|about|explain|point)/i)?.[1];
  if (numbered) {
    hints.push(`${numbered}.`);
    hints.push(` ${numbered}.`);
    const romanEntry = Object.entries(ROMAN_MAP).find(([, value]) => String(value) === numbered);
    if (romanEntry) {
      hints.push(`${romanEntry[0].toUpperCase()}.`);
      hints.push(`${romanEntry[0].toUpperCase()}. `);
    }
  }

  return Array.from(new Set(hints));
};

const extractKeywords = (query: string) => {
  const phrase = query
    .replace(/\b([ivxlc]+)\s*\./gi, ' ')
    .replace(/\b\d{1,2}\b/g, ' ')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const base = phrase
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word.toLowerCase()));

  const extras: string[] = [];
  for (const rule of GENERIC_SYNONYMS) {
    if (rule.match.test(query)) extras.push(...rule.terms);
  }
  extras.push(...expandDomainTerms(query));

  return Array.from(new Set([...base, ...extras])).slice(0, 16);
};

const scoreContent = (content: string, chapterHints: string[], keywords: string[]) => {
  const lower = ` ${content.toLowerCase()} `;
  let score = 0;

  for (const hint of chapterHints) {
    if (lower.includes(hint.toLowerCase())) score += 8;
  }

  for (const keyword of keywords) {
    if (lower.includes(keyword.toLowerCase())) score += 3;
  }

  // Light generic quality signals (not document-specific).
  if (/\b(said|explains|means|because|therefore|so)\b/i.test(content)) score += 1;
  if (/^an account of\b/i.test(content.trim()) && content.length < 120) score -= 2;
  return score;
};

/** Lexical rerank: reward query-term density and penalize TOC-like fragments. */
const rerankCandidates = (candidates: Candidate[], query: string, keywords: string[]) => {
  const queryTerms = Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^\w\s'-]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
        .concat(keywords.map((item) => item.toLowerCase()))
    )
  );

  return [...candidates]
    .map((candidate) => {
      const lower = candidate.content.toLowerCase();
      let boost = 0;
      for (const term of queryTerms) {
        const matches = lower.split(term).length - 1;
        boost += Math.min(matches, 4) * 1.5;
      }
      if (/contents\s+introduction/i.test(candidate.content)) boost -= 4;
      if (/at a glance/i.test(candidate.content) && candidate.content.length < 700) boost -= 3;
      if (candidate.content.length < 80) boost -= 2;
      if (candidate.content.length > 200 && candidate.content.length < 1800) boost += 1;
      const numbered = candidate.content.match(/\b\d{1,2}[.)]\s+\S+/g) || [];
      if (numbered.length >= 4) boost += 5;
      if (/\b(vega[mṁ]?|śloka|sloka|verse)\b/i.test(candidate.content)) boost += 3;
      return {
        ...candidate,
        score: (candidate.score ?? 0) + boost
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
};

const mergeCandidates = (...groups: Candidate[][]) => {
  const map = new Map<string, Candidate>();
  for (const group of groups) {
    for (const item of group) {
      const existing = map.get(item.id);
      if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
        map.set(item.id, item);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
};

const toCandidates = (rows: DocumentChunkRow[], chapterHints: string[], keywords: string[]): Candidate[] =>
  rows.map((row) => ({
    id: row.chunk_id,
    pageNumber: row.page_number,
    content: row.content,
    score: scoreContent(row.content, chapterHints, keywords)
  }));

export type SearchResult = {
  type: string;
  intent?: string;
  answer: string;
  sources?: Array<{ documentId?: string; pageNumber?: number; chunkId?: string; sourceText?: string }>;
  graph?: unknown;
  meta?: Record<string, unknown>;
  summary?: string;
};

export type SearchStreamEvent =
  | {
      type: 'start';
      responseType: string;
      intent?: string;
      sources?: SearchResult['sources'];
      graph?: unknown;
      meta?: Record<string, unknown>;
      summary?: string;
    }
  | { type: 'token'; text: string }
  | { type: 'done'; answer: string }
  | { type: 'error'; message: string };

const SYSTEM_PROMPT = [
  'You are a precise PDF assistant for scriptural and study texts.',
  'Answer only from the provided document context.',
  'When the user asks to name, list, or enumerate items, extract the EXACT list from the source.',
  'Keep original numbering. Preserve Sanskrit / IAST terms next to their English meaning.',
  'When the question is about a sloka, verse, or mantra: quote the verse, then give the translation, then a short explanation.',
  'Do not paraphrase a numbered table into vague prose. Do not drop items.',
  'Do not invent items that are not in the context.',
  'Use Overview / Key ideas / Bottom line only when the evidence is a short passage.',
  'When many pages mention the topic, cover every distinct teaching and cite each page.',
  'Cite page numbers when helpful.',
  'If context is insufficient, say so clearly.',
  'Few-shot — list: Question "Name 6 urges" with a numbered table in context → reproduce 1–6 exactly (Sanskrit + English). Never summarize as Overview/Key ideas.',
  'Few-shot — missing evidence: Question about the 2024 Olympics or blockchain when those words are absent → say the document does not discuss this. Do not guess.'
].join(' ');

export type SearchOptions = {
  conversationId?: string;
  history?: ChatTurn[];
  persist?: boolean;
  source?: 'api' | 'eval';
};

const buildRagContext = async (documentId: string, query: string) => {
  const wantsDetail = /detail|everything|point|explain|account|about|chapter|section|\b\d+\b|\b[ivxlc]+\b/i.test(query);
  const chapterHints = extractChapterHints(query);
  const keywords = extractKeywords(query);
  const searchTerms = Array.from(new Set([...chapterHints.map((hint) => hint.trim()), ...keywords]));

  let keywordCandidates: Candidate[] = [];
  if (searchTerms.length) {
    const conditions = searchTerms.map((_, index) => `dc.content ILIKE $${index + 2}`);
    const values = searchTerms.map((term) => `%${term}%`);
    // Rank by how many query terms a chunk matches. Ordering by page number would
    // truncate to the front of the document and hide better matches later on.
    const termHits = conditions.map((condition) => `(CASE WHEN ${condition} THEN 1 ELSE 0 END)`).join(' + ');
    const keywordResult = await getDatabase().query(
      `SELECT dc.id as chunk_id, dc.page_number, dc.content, (${termHits}) AS term_hits
       FROM document_chunks dc
       WHERE dc.document_id = $1
         AND (${conditions.join(' OR ')})
       ORDER BY term_hits DESC, dc.page_number ASC, dc.chunk_index ASC
       LIMIT $${searchTerms.length + 2}`,
      [documentId, ...values, wantsDetail ? 36 : 18]
    );
    keywordCandidates = toCandidates(keywordResult.rows as DocumentChunkRow[], chapterHints, keywords);
  }

  const provider = createEmbeddingProvider();
  const queryEmbedding = await provider.generateEmbedding(query);
  const vectorResult = await getDatabase().query(
    `SELECT dc.id as chunk_id, dc.page_number, dc.content
     FROM document_chunks dc
     JOIN document_embeddings de ON de.document_chunk_id = dc.id
     WHERE dc.document_id = $1
     ORDER BY de.embedding <-> $2
     LIMIT $3`,
    [documentId, toSql(queryEmbedding), wantsDetail ? 16 : 10]
  );
  const vectorCandidates = toCandidates(vectorResult.rows as DocumentChunkRow[], chapterHints, keywords);

  let candidates = mergeCandidates(keywordCandidates, vectorCandidates);
  candidates = rerankCandidates(candidates, query, keywords);

  if (chapterHints.length || keywords.length) {
    const threshold = chapterHints.length && !keywords.length ? 6 : 2;
    const filtered = candidates.filter((item) => (item.score ?? 0) >= threshold);
    if (filtered.length) {
      candidates = filtered;
    } else if (chapterHints.length) {
      const headingMatches = candidates.filter((item) =>
        chapterHints.some((hint) => item.content.toUpperCase().includes(hint.toUpperCase().trim()))
      );
      if (headingMatches.length) candidates = headingMatches;
    }
  }
  candidates = candidates.slice(0, wantsDetail ? 12 : 6);

  const sources = candidates.map((chunk) => ({
    documentId,
    pageNumber: chunk.pageNumber,
    chunkId: chunk.id,
    sourceText: `Page ${chunk.pageNumber}`
  }));

  const contextBlocks = candidates
    .map((chunk, index) => `[Source ${index + 1} | Page ${chunk.pageNumber}]\n${chunk.content.trim()}`)
    .join('\n\n---\n\n');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Context:\n${contextBlocks || '(no relevant passages found)'}`,
        `Question: ${query}`,
        'Write a precise Markdown answer. If the question asks to name or list items, reproduce the exact numbered list from the context (Sanskrit + English when both appear). If it asks about a sloka or verse, quote it and explain it. Do not dump unrelated sentences.'
      ].join('\n\n')
    }
  ];

  return { messages, sources };
};

const resolveSpecialResponse = async (documentId: string, query: string): Promise<SearchResult | null> => {
  const db = getDatabase();
  const documentResult = await db.query('SELECT name FROM documents WHERE id=$1', [documentId]);
  const documentName = documentResult.rows[0]?.name as string | undefined;

  const conversational = getConversationalReply(query, documentName);
  if (conversational) {
    return { type: 'TEXT_RESPONSE', intent: 'CONVERSATION', ...conversational };
  }

  const exact = await tryExactDocumentAnswer(documentId, query);
  if (exact) return exact;

  const graphResponse = await tryGraphGeneration(documentId, query);
  if (graphResponse) return graphResponse as SearchResult;

  const graphFollowUp = await tryGraphFollowUp(documentId, query);
  if (graphFollowUp) return graphFollowUp as SearchResult;

  const chapterList = await tryChapterList(documentId, query);
  if (chapterList) return chapterList as SearchResult;

  const chapterAnalysis = await tryChapterAnalysis(documentId, query);
  if (chapterAnalysis) {
    return { type: 'TEXT_RESPONSE', intent: 'CHAPTER_ANALYSIS', ...chapterAnalysis };
  }

  const deepResearch = await tryDeepDocumentResearch(documentId, query);
  if (deepResearch) return deepResearch;

  return null;
};

async function* streamPreparedAnswer(result: SearchResult): AsyncGenerator<SearchStreamEvent> {
  yield {
    type: 'start',
    responseType: result.type,
    intent: result.intent,
    sources: result.sources,
    graph: result.graph,
    meta: result.meta,
    summary: result.summary
  };
  const answer = result.answer || '';
  for await (const text of chunkTextForStream(answer, 8)) {
    yield { type: 'token', text };
  }
  yield { type: 'done', answer };
}

/** Spelling metadata attached to every response so the UI can show the fix. */
const spellingMeta = (spelling: SpellCheckResult) =>
  spelling.changed
    ? {
        spelling: {
          original: spelling.original,
          corrected: spelling.corrected,
          corrections: spelling.corrections
        }
      }
    : undefined;

const withSpellingMeta = (result: SearchResult, spelling: SpellCheckResult): SearchResult => {
  const meta = spellingMeta(spelling);
  if (!meta) return result;
  return { ...result, meta: { ...(result.meta ?? {}), ...meta } };
};

const mergeSearchMeta = (
  result: SearchResult,
  extra?: Record<string, unknown>
): SearchResult => {
  if (!extra || !Object.keys(extra).length) return result;
  return { ...result, meta: { ...(result.meta ?? {}), ...extra } };
};

const resolveHistory = async (options: SearchOptions | undefined, documentId: string) => {
  const provided = (options?.history || []).filter(
    (turn) => (turn.role === 'user' || turn.role === 'assistant') && turn.content?.trim()
  );
  if (provided.length) return { history: provided.slice(-8), conversationId: options?.conversationId };
  if (!options?.conversationId) return { history: [] as ChatTurn[], conversationId: options?.conversationId };
  const history = await loadConversationHistory(options.conversationId, 8);
  return { history, conversationId: options.conversationId };
};

const finalizeSearch = async (
  documentId: string,
  originalQuery: string,
  rewrittenQuery: string,
  rewritten: boolean,
  result: SearchResult,
  options?: SearchOptions
): Promise<SearchResult> => {
  let conversationId = options?.conversationId;
  const shouldPersist = options?.persist !== false && options?.source !== 'eval';
  if (shouldPersist) {
    conversationId = await ensureConversation(documentId, conversationId);
    await appendConversationTurn(
      conversationId,
      originalQuery,
      result.answer || '',
      (result.sources || []).map((source) => ({ ...source, documentId: source.documentId || documentId }))
    );
  }

  await logTrainingEvent({
    documentId,
    conversationId,
    eventType: options?.source === 'eval' ? 'eval' : 'search',
    question: originalQuery,
    rewrittenQuery: rewritten ? rewrittenQuery : undefined,
    answer: result.answer,
    pages: (result.sources || []).map((source) => Number(source.pageNumber)).filter(Number.isFinite),
    chunkIds: (result.sources || []).map((source) => source.chunkId).filter((id): id is string => Boolean(id)),
    intent: result.intent,
    meta: { responseType: result.type, rewritten }
  }).catch(() => undefined);

  return mergeSearchMeta(result, {
    conversationId,
    ...(rewritten ? { rewrittenQuery } : {})
  });
};

export const searchDocumentByQuery = async (
  documentId: string,
  query: string,
  options?: SearchOptions
): Promise<SearchResult> => {
  const spelling = await correctQuerySpelling(documentId, query);
  const { history, conversationId } = await resolveHistory(options, documentId);
  const rewrite = rewriteQueryWithHistory(spelling.corrected, history);
  const effectiveQuery = rewrite.query;
  const scoped = { ...options, conversationId };

  const special = await resolveSpecialResponse(documentId, effectiveQuery);
  if (special) {
    return finalizeSearch(
      documentId,
      query,
      effectiveQuery,
      rewrite.rewritten,
      withSpellingMeta(special, spelling),
      scoped
    );
  }

  const { messages, sources } = await buildRagContext(documentId, effectiveQuery);
  const llmProvider = createLLMProvider();
  const answer = await llmProvider.generateAnswer(messages);
  return finalizeSearch(
    documentId,
    query,
    effectiveQuery,
    rewrite.rewritten,
    withSpellingMeta({ type: 'TEXT_RESPONSE', intent: 'DOCUMENT_QUESTION', answer, sources }, spelling),
    scoped
  );
};

/** SSE-oriented generator: streams tokens for all answer types. */
export async function* streamSearchDocumentByQuery(
  documentId: string,
  query: string,
  options?: SearchOptions
): AsyncGenerator<SearchStreamEvent> {
  try {
    const spelling = await correctQuerySpelling(documentId, query);
    const resolved = await resolveHistory(options, documentId);
    const shouldPersist = options?.persist !== false && options?.source !== 'eval';
    const conversationId = shouldPersist
      ? await ensureConversation(documentId, resolved.conversationId)
      : resolved.conversationId;
    const history = resolved.history;
    const rewrite = rewriteQueryWithHistory(spelling.corrected, history);
    const effectiveQuery = rewrite.query;
    const scoped = { ...options, conversationId, persist: shouldPersist };
    const extraMeta = {
      conversationId,
      ...(rewrite.rewritten ? { rewrittenQuery: effectiveQuery } : {}),
      ...(spellingMeta(spelling) || {})
    };

    const special = await resolveSpecialResponse(documentId, effectiveQuery);
    if (special) {
      const finalized = await finalizeSearch(
        documentId,
        query,
        effectiveQuery,
        rewrite.rewritten,
        withSpellingMeta(special, spelling),
        scoped
      );
      for await (const event of streamPreparedAnswer(mergeSearchMeta(finalized, extraMeta))) {
        yield event;
      }
      return;
    }

    const { messages, sources } = await buildRagContext(documentId, effectiveQuery);
    yield {
      type: 'start',
      responseType: 'TEXT_RESPONSE',
      intent: 'DOCUMENT_QUESTION',
      sources,
      meta: extraMeta
    };

    const llmProvider = createLLMProvider();
    let answer = '';
    for await (const text of llmProvider.streamAnswer(messages)) {
      answer += text;
      yield { type: 'token', text };
    }

    await finalizeSearch(
      documentId,
      query,
      effectiveQuery,
      rewrite.rewritten,
      withSpellingMeta({ type: 'TEXT_RESPONSE', intent: 'DOCUMENT_QUESTION', answer, sources }, spelling),
      scoped
    );
    yield { type: 'done', answer };
  } catch (error) {
    yield {
      type: 'error',
      message: error instanceof Error ? error.message : 'Search stream failed'
    };
  }
}
