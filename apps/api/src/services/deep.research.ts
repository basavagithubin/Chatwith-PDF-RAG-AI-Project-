import { getDatabase } from '../utils/database.utils.js';
import { createLLMProvider } from '../ai/llm.provider.js';
import { isRealLLMEnabled } from '../ai/provider.config.js';
import { detectChapterRequest } from './chapter.intent.js';
import { detectExactIntent, extractBestList, foldDiacritics } from './exact.extract.js';

type PageRow = { page_number: number; text: string };

export type TopicResearch = {
  topic: string;
  tokens: string[];
  rawQuery: string;
};

type ScoredPage = {
  pageNumber: number;
  text: string;
  folded: string;
  heading: string;
  headingFolded: string;
  score: number;
  headingHit: boolean;
  chapterStart: boolean;
};

type Evidence = {
  pageNumber: number;
  heading: string;
  score: number;
  excerpts: string[];
  related: string[];
};

type Claim = { text: string; page: number; kind: 'identity' | 'glory' | 'practice' | 'comparison' | 'related' };

const QUERY_STOP = new Set([
  'tell', 'me', 'about', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or',
  'please', 'give', 'details', 'detail', 'everything', 'complete', 'information', 'info',
  'explain', 'describe', 'what', 'is', 'are', 'who', 'where', 'how', 'why', 'document',
  'pdf', 'text', 'section', 'topic', 'all', 'from', 'this', 'that', 'can', 'you', 'could',
  'would', 'should', 'want', 'know', 'full', 'every', 'entire', 'whole', 'particular',
  'pertaining', 'regarding', 'concerning', 'with', 'into', 'over', 'brief',
  'summary', 'summarize', 'analysis', 'analyze', 'analyse', 'does', 'did', 'say', 'said',
  'pdf', 'according', 'happens', 'happen', 'just', 'also', 'very', 'into'
]);

const WEAK_TOKENS = new Set(['hill', 'place', 'pond', 'lake', 'spot', 'holy', 'name', 'lord', 'sri', 'shri', 'the']);

const RELATED_PLACE_HINTS = [
  'govardhan', 'govardhana', 'vraja', 'vraj', 'radha', 'radharani', 'kunda', 'kund',
  'gokula', 'vrndavan', 'vrindavan', 'indra'
];

const strongTokens = (tokens: string[]) => {
  const strong = tokens.filter((token) => !WEAK_TOKENS.has(token) && token.length >= 4);
  return strong.length ? strong : tokens;
};

const normalizeSpace = (value: string) => value.replace(/\s+/g, ' ').trim();

const titleCase = (value: string) => {
  const text = normalizeSpace(value);
  if (!text) return 'This topic';
  return text.replace(/\b([a-z])/g, (match) => match.toUpperCase());
};

const pageWords = (folded: string) => folded.match(/[a-z]{3,}/g) || [];

/** Prefix/stem match against document words — no fuzzy edit distance on short tokens. */
const tokenMatchesWord = (token: string, word: string) => {
  if (!token || !word || word.length < 3) return false;
  if (word === token) return true;
  if (word.startsWith(token) && word.length - token.length <= 6) return true;
  if (token.startsWith(word) && token.length - word.length <= 2 && word.length >= 5) return true;
  return false;
};

const headingWords = (folded: string) =>
  folded
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((word) => word.length >= 3);

const pageHeading = (text: string) => {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 8);
  const heading = lines.find((line) =>
    /^(\d{1,2}|[IVXLC]{1,6})[.)]\s+\S/.test(line) ||
    (/[A-Z]/.test(line) && line.length > 8 && line.length < 90 && line.split(/\s+/).length <= 14)
  );
  return normalizeSpace(heading || lines[0] || '').slice(0, 90);
};

const isNumberedHeading = (heading: string) => /^(\d{1,2}|[IVXLC]{1,6})[.)]\s+\S/.test(heading.trim());

const isTocOrFrontMatter = (text: string, heading: string, headingHit: boolean) => {
  if (headingHit && isNumberedHeading(heading)) return false;
  const folded = foldDiacritics(`${heading}\n${text.slice(0, 400)}`);
  const compactHeading = foldDiacritics(heading).replace(/[^a-z]/g, '');
  if (/published and printed|copyrights for all|munshi marg|tulsi books|ecovillage/.test(folded)) return true;
  if (/contents|ataglance|authorsprofile|acknowledgements/.test(compactHeading)) return true;
  if (/contents\s+introduction|upadesamrta at a glance/.test(folded) && text.length < 1400) return true;
  return false;
};

const collectAliases = (pages: Array<{ heading: string; folded: string }>, tokens: string[]) => {
  const aliases = new Set<string>(tokens);
  for (const token of tokens) {
    aliases.add(token);
    if (token.endsWith('s') && token.length > 4) aliases.add(token.slice(0, -1));
  }
  for (const page of pages) {
    const words = [...headingWords(foldDiacritics(page.heading)), ...pageWords(page.folded).slice(0, 80)];
    for (const word of words) {
      if (tokens.some((token) => tokenMatchesWord(token, word))) aliases.add(word);
    }
  }
  return [...aliases];
};

const phrasePatterns = (tokens: string[], aliases: string[]) => {
  const patterns: RegExp[] = [];
  if (tokens.length >= 2) {
    const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    patterns.push(new RegExp(`\\b${escaped.join('[\\s-]{0,12}')}[a-z]{0,4}\\b`));
  }
  const strong = strongTokens(tokens);
  if (strong.length === 1) {
    const extra = aliases.filter((alias) => alias.startsWith(strong[0]) && alias.length > strong[0].length);
    for (const alias of extra.slice(0, 6)) {
      patterns.push(new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
    }
  }
  return patterns;
};

const mentionsAliases = (folded: string, aliases: string[]) => {
  const words = pageWords(folded);
  return aliases.some((alias) => folded.includes(alias) || words.some((word) => tokenMatchesWord(alias, word)));
};

const scoreAgainstTopic = (
  folded: string,
  headingFolded: string,
  tokens: string[],
  aliases: string[],
  phrases: RegExp[]
) => {
  let score = 0;
  let headingHit = false;
  const headingWordsList = headingWords(headingFolded);
  if (aliases.some((alias) => headingWordsList.some((word) => tokenMatchesWord(alias, word) || word.includes(alias)))) {
    score += 20;
    headingHit = true;
  }
  for (const phrase of phrases) {
    if (phrase.test(folded)) score += 12;
  }
  const bodyHits = aliases.filter((alias) =>
    pageWords(folded).some((word) => tokenMatchesWord(alias, word)) || folded.includes(alias)
  ).length;
  if (bodyHits) score += Math.min(bodyHits, 4) * 4;
  if (tokens.length > 1 && bodyHits === 1 && !headingHit) score -= 2;
  return { score, headingHit };
};

export const detectTopicResearch = (query: string): TopicResearch | null => {
  const text = query.trim();
  if (!text || text.length < 3) return null;
  if (detectChapterRequest(text)) return null;
  const exact = detectExactIntent(text);
  if (exact?.type === 'list') return null;
  if (/\b(graph|diagram|visualize|visualise|concept\s*map|mind\s*map)\b/i.test(text)) return null;

  const stripped = text
    .replace(/[?!.:,;]+/g, ' ')
    .replace(/\b(tell me about|tell me|give me|details? of|everything about|all about|complete details of|information (?:on|about)|what is|what's|who is|where is|explain|describe)\b/gi, ' ')
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = foldDiacritics(stripped)
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z]/g, ''))
    .filter((word) => word.length >= 3 && !QUERY_STOP.has(word));

  if (!tokens.length) return null;
  const topic = tokens.join(' ');
  if (topic.length < 3) return null;
  return { topic, tokens, rawQuery: text };
};

const splitUnits = (text: string) => {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZĀĪŪṚ])/);
  const units: string[] = [];
  for (const block of blocks) {
    const cleaned = normalizeSpace(block);
    if (cleaned.length >= 24 && cleaned.length <= 420) units.push(cleaned);
    else if (cleaned.length > 420) {
      for (const part of cleaned.split(/(?<=[.!?])\s+/)) {
        const item = normalizeSpace(part);
        if (item.length >= 24 && item.length <= 360) units.push(item);
      }
    }
  }
  return units;
};

const uniqueTexts = (items: string[]) => {
  const result: string[] = [];
  for (const item of items) {
    const key = foldDiacritics(item).slice(0, 48);
    if (result.some((existing) => foldDiacritics(existing).slice(0, 48) === key)) continue;
    result.push(item);
  }
  return result;
};

const collectEvidence = (pages: PageRow[], research: TopicResearch): { evidence: Evidence[]; aliases: string[] } => {
  const prepared = pages.map((page) => {
    const heading = pageHeading(page.text || '');
    return {
      pageNumber: page.page_number,
      text: page.text || '',
      folded: foldDiacritics(page.text || ''),
      heading,
      headingFolded: foldDiacritics(heading)
    };
  });

  const tokens = strongTokens(research.tokens);
  const aliases = collectAliases(prepared, tokens);
  const phrases = phrasePatterns(tokens, aliases);

  const scored: ScoredPage[] = prepared.map((page) => {
    const { score, headingHit } = scoreAgainstTopic(page.folded, page.headingFolded, tokens, aliases, phrases);
    return {
      ...page,
      score,
      headingHit,
      chapterStart: headingHit && isNumberedHeading(page.heading)
    };
  });

  const primary = scored.filter((page) => {
    if (page.score < 4) return false;
    if (isTocOrFrontMatter(page.text, page.heading, page.headingHit)) return false;
    return true;
  });

  const chapterStarts = primary.filter((page) => page.chapterStart).map((page) => page.pageNumber);
  const follow: ScoredPage[] = [];
  for (const start of chapterStarts) {
    for (const page of scored) {
      if (page.pageNumber <= start) continue;
      if (isNumberedHeading(page.heading) && !page.headingHit) break;
      if (primary.some((item) => item.pageNumber === page.pageNumber)) continue;
      if (isTocOrFrontMatter(page.text, page.heading, page.headingHit)) continue;
      if (mentionsAliases(page.folded, aliases) || page.score >= 2) {
        follow.push({ ...page, score: Math.max(page.score, 6) });
      } else if (page.pageNumber <= start + 2) {
        follow.push({ ...page, score: 4 });
      } else {
        break;
      }
    }
  }

  const selected = [...primary, ...follow]
    .sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber)
    .slice(0, 24);

  const evidence: Evidence[] = selected.map((page) => {
    const units = splitUnits(page.text);
    const excerpts = uniqueTexts(
      units.filter((unit) => mentionsAliases(foldDiacritics(unit), aliases))
    ).slice(0, 8);
    const related = RELATED_PLACE_HINTS.filter(
      (hint) => page.folded.includes(hint) && !tokens.some((token) => tokenMatchesWord(token, hint))
    );
    return {
      pageNumber: page.pageNumber,
      heading: page.heading,
      score: page.score + (page.headingHit ? 8 : 0) + excerpts.length,
      excerpts,
      related
    };
  });

  return {
    evidence: evidence.filter((item) => item.excerpts.length || item.score >= 20).slice(0, 18),
    aliases
  };
};

const classifyClaim = (text: string, folded: string): Claim['kind'] => {
  if (/\b(bathe|bathing|reside|residing|stay|shelter|must|should|practice|chant)\b/.test(folded)) return 'practice';
  if (/\b(superior|above|more dear|holiest|dearer|even more)\b/.test(folded)) return 'comparison';
  if (/\b(glor(?:y|ies)|prema|love overflows|most dear|dearest|nectar)\b/.test(folded)) return 'glory';
  if (/\b(govardhan|vraja|radharani|gokula|vrndavan|indra)\b/.test(folded) && !/^\d+\.\s+/.test(text)) {
    return 'related';
  }
  if (/\b(is|stands|called|means|known as|pond|hill|place)\b/.test(folded)) return 'identity';
  return 'identity';
};

const extractClaims = (evidence: Evidence[], aliases: string[]): Claim[] => {
  const claims: Claim[] = [];
  for (const item of [...evidence].sort((a, b) => a.pageNumber - b.pageNumber)) {
    for (const excerpt of item.excerpts) {
      const folded = foldDiacritics(excerpt);
      if (!mentionsAliases(folded, aliases)) continue;
      if (/author'?s profile|published and printed|copyrights/.test(folded)) continue;
      const key = folded.slice(0, 42);
      if (claims.some((claim) => foldDiacritics(claim.text).slice(0, 42) === key)) continue;
      claims.push({
        text: excerpt.length > 280 ? `${excerpt.slice(0, 277).trim()}…` : excerpt,
        page: item.pageNumber,
        kind: classifyClaim(excerpt, folded)
      });
      if (claims.length >= 24) return claims;
    }
  }
  return claims;
};

const formatDeterministic = (research: TopicResearch, evidence: Evidence[], aliases: string[]) => {
  const looksLikeTitle = (value: string) => {
    const words = value.split(/\s+/).filter(Boolean);
    return value.length <= 70 && words.length <= 12 && !/\b(because|like|which|that)\b/i.test(value);
  };
  const headingTitle = [...evidence]
    .sort((a, b) => b.score - a.score)
    .find((item) => looksLikeTitle(item.heading) && mentionsAliases(foldDiacritics(item.heading), aliases))
    ?.heading;
  const title = headingTitle && headingTitle.length < 80 ? headingTitle : titleCase(research.topic);
  const pages = [...new Set(evidence.map((item) => item.pageNumber))].sort((a, b) => a - b);
  const claims = extractClaims(evidence, aliases);
  const byKind = (kind: Claim['kind']) => claims.filter((claim) => claim.kind === kind).slice(0, 6);
  const overview =
    byKind('glory')[0] ||
    byKind('identity')[0] ||
    claims[0] ||
    { text: `The document discusses **${title}** on the pages listed below.`, page: pages[0] };

  const lists = evidence
    .map((item) => {
      const extracted = extractBestList(`${item.heading}\n${item.excerpts.join('\n')}`, {
        type: 'list',
        topic: research.topic,
        rawQuery: research.rawQuery
      }, item.pageNumber);
      return extracted && extracted.items.length >= 3 ? { page: item.pageNumber, extracted } : null;
    })
    .filter(Boolean)
    .slice(0, 1);

  const related = [...new Set(evidence.flatMap((item) => item.related))]
    .slice(0, 8)
    .map((term) => {
      const page = evidence.find((item) => item.related.includes(term));
      return page ? `- **${titleCase(term)}** — mentioned with this topic (p. ${page.pageNumber})` : '';
    })
    .filter(Boolean);

  const section = (label: string, rows: Claim[]) => {
    if (!rows.length) return [];
    return ['', `### ${label}`, ...rows.map((row) => `- ${row.text} *(p. ${row.page})*`)];
  };

  const parts = [
    `## ${title}`,
    '',
    `Deep research across the full document found **${pages.length}** relevant page(s).`,
    '',
    '### What it is',
    `${overview.text} (p. ${overview.page})`,
    ...section('Glories', byKind('glory')),
    ...section('Practices', byKind('practice')),
    ...section('Comparisons', byKind('comparison'))
  ];

  const leftover = claims.filter(
    (claim) => !['glory', 'practice', 'comparison'].includes(claim.kind) && claim.text !== overview.text
  ).slice(0, 8);
  parts.push(...section('Further teachings', leftover));

  if (lists.length) {
    parts.push('', '### Structured points in the source');
    for (const list of lists) {
      if (!list) continue;
      parts.push(`From page ${list.page}:`);
      parts.push(
        ...list.extracted.items.slice(0, 8).map((item) =>
          item.sanskrit ? `- **${item.sanskrit}** — ${item.english}` : `- ${item.english}`
        )
      );
    }
  }

  if (related.length) {
    parts.push('', '### Related places and concepts', ...related);
  }

  parts.push(
    '',
    '### Source index',
    ...evidence
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((item) => `- **Page ${item.pageNumber}** — ${item.heading || 'Mention in running text'}`)
  );

  return parts.join('\n');
};

const refineWithLLM = async (research: TopicResearch, evidence: Evidence[], digest: string) => {
  if (!isRealLLMEnabled()) return null;
  try {
    const provider = createLLMProvider();
    const answer = await provider.generateAnswer([
      {
        role: 'system',
        content: [
          'You do comprehensive document analysis, not shallow RAG.',
          'Use only the structured digest. Cite page numbers like (p. 77).',
          'Preserve Sanskrit / IAST. Do not invent facts or mention publisher/copyright pages.',
          'Write Markdown with: What it is, Glories, Practices, Related places, Source index.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [`Topic: ${research.topic}`, `Question: ${research.rawQuery}`, digest.slice(0, 8000)].join('\n\n')
      }
    ]);
    if (answer && answer.length > 240) return answer;
  } catch {
    /* keep deterministic briefing */
  }
  return null;
};

export const tryDeepDocumentResearch = async (documentId: string, query: string) => {
  const research = detectTopicResearch(query);
  if (!research) return null;

  const result = await getDatabase().query(
    `SELECT page_number, text
     FROM document_pages
     WHERE document_id = $1
     ORDER BY page_number ASC`,
    [documentId]
  );
  const pages = (result.rows as PageRow[]).filter((row) => (row.text || '').trim());
  if (!pages.length) return null;

  const { evidence, aliases } = collectEvidence(pages, research);
  if (!evidence.length) return null;
  const hasTopicHeading = evidence.some((item) => mentionsAliases(foldDiacritics(item.heading), aliases));
  const bestScore = Math.max(...evidence.map((item) => item.score));
  if (!hasTopicHeading && bestScore < 24) return null;

  const draft = formatDeterministic(research, evidence, aliases);
  const refined = await refineWithLLM(research, evidence, draft);
  const pagesCovered = [...new Set(evidence.map((item) => item.pageNumber))].sort((a, b) => a - b);

  return {
    type: 'TEXT_RESPONSE' as const,
    intent: 'DEEP_RESEARCH',
    answer: refined || draft,
    sources: pagesCovered.map((pageNumber) => ({
      documentId,
      pageNumber,
      sourceText: `Page ${pageNumber}`
    })),
    meta: {
      type: 'DEEP_RESEARCH',
      topic: research.topic,
      pagesScanned: pages.length,
      mentionPages: pagesCovered.length,
      aliases
    }
  };
};
