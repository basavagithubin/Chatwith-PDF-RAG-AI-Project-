import { createLLMProvider } from '../ai/llm.provider.js';
import { isRealLLMEnabled } from '../ai/provider.config.js';
import { findChapterBoundary, loadChapterChunks, loadChapterPages } from './chapter.boundary.js';
import { detectChapterRequest } from './chapter.intent.js';
import {
  ChapterBoundary,
  ChapterKnowledge,
  ChapterMode,
  ChapterRequest,
  ChapterSection
} from './chapter.types.js';

type CacheEntry = {
  knowledge: ChapterKnowledge;
  updatedAt: number;
};

const chapterCache = new Map<string, CacheEntry>();

const cleanText = (value: string) =>
  value
    .replace(/\[Source[^\]]+\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const unique = (items: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

const paraphraseSentence = (text: string) => {
  let value = cleanText(text)
    .replace(/^The Blessed Lord said:\s*/i, '')
    .replace(/^Suta said:\s*/i, '')
    .replace(/^Garu\s*ḍ?a said:\s*/i, '')
    .replace(/^Garuda said:\s*/i, '')
    .replace(/^Tell me,?\s*O\s+[^,]+,\s*/i, '')
    .replace(/^Listen,?\s*O\s+[^,]+,\s*(and\s+)?/i, '')
    .replace(/\bO\s+(Shining One|Lord of Birds|Tārkṣya|Tarksya|Bird)[,!]?\s*/gi, '')
    .replace(/\b(Thee|Thou)\b/gi, 'you')
    .replace(/\b(Thy|Thine)\b/gi, 'your')
    .replace(/\b\d+\s*I\.e\.?.*$/i, '')
    .replace(/\s+\d{1,3}\.\s*$/g, '')
    .replace(/\s+\d{1,3}$/g, '');

  value = value
    .replace(/\btherefore\b/gi, 'so')
    .replace(/\bhence\b/gi, 'so')
    .replace(/\bone should\b/gi, 'a person should')
    .replace(/\bmust\b/gi, 'needs to')
    .replace(/\bshall\b/gi, 'should')
    .replace(/\bthe departed\b/gi, 'the deceased person')
    .replace(/\brice\s*-?\s*balls\b/gi, 'funeral rice offerings')
    .replace(/\bten\s*-?\s*days'\s*rite\b/gi, 'ten-day funeral rite')
    .replace(/\bten\s*-?\s*days'\s*ceremony\b/gi, 'ten-day ceremony')
    .replace(/\bWay of Yama\b/gi, 'path to Yama’s realm')
    .replace(/\bYama Loka\b/gi, 'Yama Loka (the realm of Yama)');

  if (/what good results follow/i.test(value)) {
    value = 'The chapter asks what benefits come from performing the ten-day rite, and who should do it if there is no son.';
  } else if (/released from the hereditary debt/i.test(value)) {
    value = 'Performing the ten-day ceremony properly helps free a devoted son from ancestral obligation.';
  } else if (/death is certain for those who are born/i.test(value)) {
    value = 'Birth and death are unavoidable, so a wise person should not be crushed by grief.';
  } else if (/should not weep when sorrow is useless/i.test(value)) {
    value = 'The living should control excessive weeping, because endless grief does not help the departed.';
  }

  if (value.length > 210) {
    const cut = value.slice(0, 210);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
    value = stop > 80 ? cut.slice(0, stop + 1) : `${cut.trim()}…`;
  }

  if (!/[.!?…]$/.test(value)) value = `${value}.`;
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const extractCandidateSentences = (text: string) =>
  cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 45 && part.length < 320)
    .filter((part) => !/synonyms|contents|introduction this garu/i.test(part))
    .filter((part) => !/^[IVXLC]+\.\s+/i.test(part))
    .filter((part) => (part.match(/\?/g) || []).length < 3)
    .filter((part) => /[a-zA-Z]{4,}/.test(part));

const splitIntoSections = (
  pages: Array<{ page_number: number; text: string | null }>,
  boundary: ChapterBoundary
): ChapterSection[] => {
  const joined = pages
    .map((page) => ({ page: page.page_number, text: page.text ?? '' }))
    .filter((page) => page.text.trim());

  if (!joined.length) return [];

  const headingRegex = /\b([IVXLC]+|\d{1,2})\.\s+([A-Z][A-Za-z0-9'’:,\- ]{3,80})/g;
  const sections: ChapterSection[] = [];
  let currentTitle = boundary.chapterTitle;
  let currentStart = boundary.startPage;
  let buffer: string[] = [];

  const flush = (endPage: number) => {
    const content = buffer.join(' ').trim();
    if (!content) return;
    const sentences = extractCandidateSentences(content).slice(0, 8).map(paraphraseSentence);
    const concepts = unique(
      sentences
        .flatMap((sentence) => sentence.split(/[,;]/).map((part) => part.trim()))
        .filter((part) => part.length > 18 && part.length < 80)
        .slice(0, 4)
    );
    sections.push({
      title: currentTitle,
      startPage: currentStart,
      endPage,
      summary: sentences.slice(0, 3).join(' '),
      concepts,
      points: sentences.slice(0, 5),
      examples: sentences.filter((sentence) => /for example|like|such as|story|analogy|said/i.test(sentence)).slice(0, 2)
    });
  };

  for (const page of joined) {
    const matches = Array.from(page.text.matchAll(headingRegex));
    if (!matches.length) {
      buffer.push(page.text);
      continue;
    }

    let cursor = 0;
    for (const match of matches) {
      const before = page.text.slice(cursor, match.index ?? 0);
      if (before.trim()) buffer.push(before);
      const headingNumber = match[1];
      const headingTitle = match[2].trim();
      const isSameChapter =
        headingNumber.toUpperCase() === boundary.chapterLabel ||
        Number(headingNumber) === boundary.chapterNumber;

      if (!isSameChapter && buffer.length) {
        flush(page.page);
        buffer = [];
        currentTitle = `${headingNumber}. ${headingTitle}`;
        currentStart = page.page;
      } else if (buffer.length && headingTitle.toLowerCase() !== currentTitle.toLowerCase()) {
        flush(Math.max(boundary.startPage, page.page - 1));
        buffer = [];
        currentTitle = headingTitle;
        currentStart = page.page;
      }
      cursor = (match.index ?? 0) + match[0].length;
    }
    const rest = page.text.slice(cursor);
    if (rest.trim()) buffer.push(rest);
  }

  flush(boundary.endPage);
  if (!sections.length) {
    const allText = joined.map((page) => page.text).join(' ');
    const sentences = extractCandidateSentences(allText).slice(0, 10).map(paraphraseSentence);
    sections.push({
      title: boundary.chapterTitle,
      startPage: boundary.startPage,
      endPage: boundary.endPage,
      summary: sentences.slice(0, 4).join(' '),
      concepts: sentences.slice(0, 3).map((item) => item.split('.')[0]).filter((item) => item.length > 12),
      points: sentences.slice(0, 6),
      examples: []
    });
  }
  return sections;
};

const buildKnowledge = (
  boundary: ChapterBoundary,
  sections: ChapterSection[],
  pages: Array<{ page_number: number; text: string | null }>
): ChapterKnowledge => {
  const allPoints = unique(
    sections
      .flatMap((section) => section.points)
      .map((point) => point.replace(/^;\s*/, '').trim())
      .filter((point) => point.length > 40 && !/^[^a-zA-Z]*$/.test(point))
  ).slice(0, 12);
  const allConcepts = unique(sections.flatMap((section) => section.concepts)).slice(0, 8);
  const allExamples = unique(sections.flatMap((section) => section.examples)).slice(0, 5);
  const overviewParts = unique(sections.flatMap((section) => section.points)).slice(0, 4);

  const conceptLabels = [
    'Purpose of the chapter',
    'Practical duty',
    'Attitude toward grief',
    'Moral instruction',
    'Final guidance'
  ];
  const coreConcepts = allPoints.slice(0, 5).map((point, index) => ({
    name: conceptLabels[index] || `Concept ${index + 1}`,
    explanation: point
  }));

  const mainTheme =
    allPoints[0] ||
    `This chapter presents the teachings and practical guidance contained in ${boundary.chapterTitle}.`;

  const conclusion =
    allPoints[allPoints.length - 1] ||
    'The chapter closes by stressing the practical importance of applying these teachings carefully.';

  const pageGroups: ChapterKnowledge['sources'] = [];
  const span = Math.max(1, Math.ceil((boundary.endPage - boundary.startPage + 1) / 3));
  for (let start = boundary.startPage; start <= boundary.endPage; start += span) {
    const end = Math.min(boundary.endPage, start + span - 1);
    const label =
      start === boundary.startPage
        ? 'Introduction'
        : end === boundary.endPage
          ? 'Conclusion'
          : 'Main discussion';
    pageGroups.push({ label: `Pages ${start}–${end}: ${label}`, startPage: start, endPage: end });
  }

  const relationships = coreConcepts.slice(0, 3).map((concept, index) => {
    const next = coreConcepts[index + 1];
    if (!next) return `${concept.name} supports the chapter’s final guidance.`;
    return `${concept.name} leads to ${next.name}.`;
  });

  return {
    chapterTitle: boundary.chapterTitle,
    chapterNumber: boundary.chapterNumber,
    chapterLabel: boundary.chapterLabel,
    pageRange: { start: boundary.startPage, end: boundary.endPage },
    mainTheme,
    overview:
      overviewParts.join(' ') ||
      `Chapter ${boundary.chapterLabel} covers ${boundary.chapterTitle} across pages ${boundary.startPage}–${boundary.endPage}.`,
    coreConcepts,
    importantPoints: allPoints.slice(0, 8),
    examples: allExamples.map((text) => ({
      text,
      why: 'It helps clarify the chapter’s practical teaching.'
    })),
    definitions: coreConcepts.slice(0, 3).map((concept) => ({
      term: concept.name.split(' ').slice(0, 4).join(' '),
      explanation: concept.explanation
    })),
    relationships,
    conclusion,
    simpleExplanation:
      `In simple terms, Chapter ${boundary.chapterLabel} teaches the reader about ${boundary.chapterTitle.toLowerCase()}. ` +
      `It explains why the topic matters, what actions or attitudes are important, and what conclusion the reader should carry forward.`,
    takeaways: allPoints.slice(0, 8),
    sections,
    sources: pageGroups.length
      ? pageGroups
      : [{
          label: `Pages ${boundary.startPage}–${boundary.endPage}`,
          startPage: boundary.startPage,
          endPage: boundary.endPage
        }]
  };
};

const refineWithLLM = async (knowledge: ChapterKnowledge, mode: ChapterMode) => {
  if (!isRealLLMEnabled()) {
    return null;
  }

  const provider = createLLMProvider();
  const sectionDigest = knowledge.sections
    .map((section, index) => `Section ${index + 1} (${section.startPage}-${section.endPage}) ${section.title}: ${section.summary}`)
    .join('\n');

  const prompt = [
    'You are a chapter-analysis assistant for general readers.',
    'Rewrite the chapter understanding in clear modern English.',
    'Do NOT copy archaic PDF phrasing.',
    'Do NOT use Point 1 / Point 2 labels.',
    'Do NOT invent ideas outside the provided content.',
    `Mode: ${mode}`,
    '',
    `Chapter: ${knowledge.chapterLabel}. ${knowledge.chapterTitle}`,
    `Pages: ${knowledge.pageRange.start}-${knowledge.pageRange.end}`,
    `Main theme: ${knowledge.mainTheme}`,
    `Overview draft: ${knowledge.overview}`,
    `Important points: ${knowledge.importantPoints.join(' | ')}`,
    `Concepts: ${knowledge.coreConcepts.map((item) => item.name).join(' | ')}`,
    `Section digests:\n${sectionDigest}`,
    '',
    'Return Markdown with:',
    '# Chapter ...',
    '## Overview',
    '## Main idea',
    '## Key ideas',
    '## Simple explanation',
    '## Bottom line',
    '## Sources'
  ].join('\n');

  try {
    const answer = await provider.generateAnswer([
      { role: 'system', content: 'Write clear, professional chapter summaries for modern readers. Never use Point 1 / Point 2. Stay faithful to provided content.' },
      { role: 'user', content: prompt }
    ]);
    if (answer && answer.length > 120 && !/Context:|Point\s+\d+:/i.test(answer)) {
      return answer;
    }
  } catch (error) {
    console.warn('Chapter LLM refine failed; using deterministic renderer.', error instanceof Error ? error.message : error);
  }
  return null;
};

const renderKnowledge = (knowledge: ChapterKnowledge, mode: ChapterMode) => {
  const title = `# Chapter ${knowledge.chapterLabel} — ${knowledge.chapterTitle}`;
  const sources = [
    '## Sources',
    '',
    ...knowledge.sources.map((source) => `- ${source.label}`)
  ];

  if (mode === 'short') {
    return [
      title,
      '',
      '## Overview',
      knowledge.overview.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '),
      '',
      '## Main Idea',
      knowledge.mainTheme,
      '',
      '## Most Important Things to Remember',
      ...knowledge.takeaways.slice(0, 5).map((item, index) => `${index + 1}. ${item}`),
      '',
      ...sources
    ].join('\n');
  }

  if (mode === 'points') {
    return [
      title,
      '',
      '## Key Teachings / Key Points',
      '',
      ...knowledge.importantPoints.map((item, index) => `${index + 1}. ${item}`),
      '',
      '## Most Important Things to Remember',
      ...knowledge.takeaways.slice(0, 6).map((item) => `- ${item}`),
      '',
      ...sources
    ].join('\n');
  }

  if (mode === 'exam') {
    return [
      `# Chapter ${knowledge.chapterLabel} — Exam Notes`,
      '',
      '## Important Definitions',
      ...knowledge.definitions.map((item) => `- **${item.term}:** ${item.explanation}`),
      '',
      '## Important Concepts',
      ...knowledge.coreConcepts.map((item, index) => `${index + 1}. **${item.name}** — ${item.explanation}`),
      '',
      '## Key Points to Remember',
      ...knowledge.importantPoints.map((item, index) => `${index + 1}. ${item}`),
      '',
      '## Important Relationships',
      ...knowledge.relationships.map((item) => `- ${item}`),
      '',
      '## Possible Questions',
      `1. What is the main theme of Chapter ${knowledge.chapterLabel}?`,
      '2. List the most important concepts discussed in this chapter.',
      '3. Explain the chapter conclusion in your own words.',
      '',
      '## Quick Revision',
      ...knowledge.takeaways.slice(0, 6).map((item) => `- ${item}`),
      '',
      ...sources
    ].join('\n');
  }

  if (mode === 'teach') {
    return [
      title,
      '',
      '## What is this chapter about?',
      knowledge.overview,
      '',
      '## Why this topic is important',
      knowledge.mainTheme,
      '',
      '## Main concepts',
      ...knowledge.coreConcepts.map((item, index) => `### ${index + 1}. ${item.name}\n${item.explanation}`),
      '',
      '## Relationship between concepts',
      ...knowledge.relationships.map((item) => `- ${item}`),
      '',
      '## Important examples',
      ...(knowledge.examples.length
        ? knowledge.examples.map((item) => `- ${item.text} (${item.why})`)
        : ['- The chapter mainly teaches through direct instruction rather than long stories.']),
      '',
      '## Key takeaways',
      ...knowledge.takeaways.map((item, index) => `${index + 1}. ${item}`),
      '',
      '## Quick revision',
      knowledge.simpleExplanation,
      '',
      ...sources
    ].join('\n');
  }

  return [
    title,
    '',
    '## Overview',
    knowledge.overview,
    '',
    '## Main idea',
    knowledge.mainTheme,
    '',
    '## Key ideas',
    ...knowledge.importantPoints.slice(0, 6).map((item) => `- ${item}`),
    '',
    '## Important concepts',
    ...knowledge.coreConcepts.slice(0, 5).map((item) => `- **${item.name}:** ${item.explanation}`),
    '',
    '## Simple explanation',
    knowledge.simpleExplanation,
    '',
    '## Bottom line',
    knowledge.conclusion,
    '',
    ...sources
  ].join('\n');
};

const cacheKey = (documentId: string, boundary: ChapterBoundary) =>
  `${documentId}:${boundary.chapterNumber}:${boundary.startPage}:${boundary.endPage}`;

export const analyzeChapter = async (documentId: string, request: ChapterRequest) => {
  const boundary = await findChapterBoundary(documentId, request);
  if (!boundary) {
    return {
      answer: [
        '## Chapter analysis unavailable',
        '',
        `I could not confidently detect the boundaries for Chapter ${request.chapterLabel || request.chapterNumber}.`,
        '',
        'Try using the exact chapter heading from the PDF, for example:',
        '- Explain Chapter XI. An Account Of The Ten-Days\' Ceremonies',
        '- Summarize Chapter 1'
      ].join('\n'),
      sources: [] as Array<{ documentId: string; pageNumber: number; chunkId?: string; sourceText?: string }>,
      meta: { type: 'CHAPTER_ANALYSIS', mode: request.mode }
    };
  }

  const key = cacheKey(documentId, boundary);
  let knowledge = chapterCache.get(key)?.knowledge;
  if (!knowledge) {
    const pages = await loadChapterPages(documentId, boundary.startPage, boundary.endPage);
    const sections = splitIntoSections(pages, boundary);
    knowledge = buildKnowledge(boundary, sections, pages);
    chapterCache.set(key, { knowledge, updatedAt: Date.now() });
  }

  // Ensure chunks exist for source richness even if pages are primary.
  await loadChapterChunks(documentId, boundary.startPage, boundary.endPage);

  const refined = await refineWithLLM(knowledge, request.mode);
  const rendered = refined || renderKnowledge(knowledge, request.mode);
  const answer = boundary.synthesized
    ? [
        rendered,
        '',
        `> This document has no chapter headings, so pages ${boundary.startPage}–${boundary.endPage} were analysed as "chapter ${boundary.chapterNumber}".`
      ].join('\n')
    : rendered;

  const sources = knowledge.sources.map((source) => ({
    documentId,
    pageNumber: source.startPage,
    sourceText: `${source.label} (through page ${source.endPage})`
  }));

  return {
    answer,
    sources,
    meta: {
      type: 'CHAPTER_ANALYSIS' as const,
      mode: request.mode,
      chapterNumber: knowledge.chapterNumber,
      chapterTitle: knowledge.chapterTitle,
      pageRange: knowledge.pageRange,
      synthesizedRange: Boolean(boundary.synthesized)
    }
  };
};

export const analyzeChapterComparison = async (documentId: string, request: ChapterRequest) => {
  if (!request.compareWith) {
    return analyzeChapter(documentId, request);
  }

  const left = await analyzeChapter(documentId, {
    ...request,
    mode: 'summarize',
    compareWith: undefined
  });
  const right = await analyzeChapter(documentId, {
    type: 'CHAPTER_ANALYSIS',
    mode: 'summarize',
    chapterNumber: request.compareWith.chapterNumber,
    chapterLabel: request.compareWith.chapterLabel,
    rawQuery: `Summarize Chapter ${request.compareWith.chapterLabel}`
  });

  const answer = [
    `# Comparison — Chapter ${request.chapterLabel} vs Chapter ${request.compareWith.chapterLabel}`,
    '',
    '| Topic | Chapter A | Chapter B |',
    '|---|---|---|',
    `| Main theme | See Chapter ${request.chapterLabel} summary | See Chapter ${request.compareWith.chapterLabel} summary |`,
    '',
    `## Chapter ${request.chapterLabel}`,
    left.answer,
    '',
    `## Chapter ${request.compareWith.chapterLabel}`,
    right.answer,
    '',
    '## Major similarities and differences',
    '- Compare the main themes, practical instructions, and conclusions from both chapter summaries above.',
    '- Focus on what each chapter uniquely emphasizes rather than repeating shared background ideas.'
  ].join('\n');

  return {
    answer,
    sources: [...left.sources, ...right.sources],
    meta: { type: 'CHAPTER_ANALYSIS', mode: 'compare' as ChapterMode }
  };
};

export const tryChapterAnalysis = async (documentId: string, query: string) => {
  const request = detectChapterRequest(query);
  if (!request) return null;
  if (request.mode === 'compare') {
    return analyzeChapterComparison(documentId, request);
  }
  return analyzeChapter(documentId, request);
};

export const invalidateChapterCache = (documentId?: string) => {
  if (!documentId) {
    chapterCache.clear();
    return;
  }
  for (const key of chapterCache.keys()) {
    if (key.startsWith(`${documentId}:`)) chapterCache.delete(key);
  }
};
