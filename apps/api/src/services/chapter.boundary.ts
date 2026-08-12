import { getDatabase } from '../utils/database.utils.js';
import { ChapterBoundary, ChapterRequest } from './chapter.types.js';

type PageRow = {
  page_number: number;
  text: string | null;
};

type HeadingHit = {
  page: number;
  label: string;
  title: string;
  number: number;
  index: number;
  onTocPage: boolean;
  isRoman?: boolean;
};

const ROMAN_MAP: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
  xxi: 21, xxii: 22, xxiii: 23, xxiv: 24, xxv: 25
};

const toNumber = (token: string) => {
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  return ROMAN_MAP[lower] ?? null;
};

const toRoman = (value: number) => {
  const entry = Object.entries(ROMAN_MAP).find(([, number]) => number === value);
  return entry?.[0]?.toUpperCase() || String(value);
};

const HEADING_REGEX =
  /\b(?:CHAPTER\s+)?([IVXLC]{1,6}|\d{1,2})\.\s+([A-Z][A-Za-z0-9'’:,\- ]{6,120})/g;

const cleanHeadingTitle = (raw: string) =>
  raw
    .replace(/\s+/g, ' ')
    .trim()
    // Cut accidental next-chapter bleed in TOC lines ("... Other II" / "... Fire XI.").
    .split(/\s+[IVXLC]{1,6}\.\s+/)[0]
    .replace(/\s+[IVXLC]{1,6}\.?$/i, '')
    .replace(/\s+\d{1,3}$/g, '')
    .replace(/[.:,\-]+$/, '')
    .trim();

const looksLikeChapterTitle = (title: string) => {
  if (title.length < 10 || title.length > 90) return false;
  if (/said:/i.test(title)) return false;
  if (/\b(listen then|listen how|listen,|very sinful|hungry and|powerful death)\b/i.test(title)) return false;
  // Prefer title-like phrases over mid-sentence fragments.
  const words = title.split(/\s+/);
  if (words.length < 3) return false;
  return true;
};

const collectHeadings = (pages: PageRow[]): HeadingHit[] => {
  const raw: Array<Omit<HeadingHit, 'onTocPage' | 'index'> & { index?: number }> = [];

  for (const page of pages) {
    const text = page.text ?? '';
    for (const match of text.matchAll(HEADING_REGEX)) {
      const number = toNumber(match[1]);
      if (!number) continue;
      const title = cleanHeadingTitle(match[2]);
      if (!looksLikeChapterTitle(title)) continue;
      if (/^(THE|AND|FOR|WITH|FROM)\b/i.test(title) && title.length < 12) continue;
      raw.push({
        page: page.page_number,
        label: /^[IVXLC]+$/i.test(match[1]) ? match[1].toUpperCase() : toRoman(number),
        title,
        number,
        isRoman: /^[IVXLC]+$/i.test(match[1])
      } as any);
    }
  }

  const counts = new Map<number, number>();
  for (const hit of raw) {
    counts.set(hit.page, (counts.get(hit.page) ?? 0) + 1);
  }

  return raw.map((hit, index) => ({
    page: hit.page,
    label: hit.label,
    title: hit.title,
    number: hit.number,
    index,
    onTocPage: (counts.get(hit.page) ?? 0) >= 4,
    isRoman: Boolean((hit as any).isRoman)
  })) as HeadingHit[];
};

const scoreHeading = (heading: HeadingHit, request: ChapterRequest) => {
  let score = 0;
  if (!heading.onTocPage) score += 20;
  if (request.chapterTitleHint) {
    const left = heading.title.toLowerCase();
    const right = request.chapterTitleHint.toLowerCase();
    if (left.includes(right) || right.includes(left)) score += 30;
    for (const word of right.split(/\s+/).filter((part) => part.length >= 4)) {
      if (left.includes(word)) score += 3;
    }
  }
  // Prefer later occurrences (actual chapter body over TOC).
  score += Math.min(heading.page, 40) * 0.2;
  if (/account of|ceremony|rite|path|way of|birth|sin/i.test(heading.title)) score += 4;
  return score;
};

const SYNTHETIC_PART_MIN_PAGES = 3;
const SYNTHETIC_PART_MAX_COUNT = 12;

/**
 * Short documents (single hymns, articles, handouts) carry no chapter headings,
 * so "chapter 1" would otherwise be unanswerable. Split them into even parts and
 * treat the requested number as a part index.
 */
const synthesizeBoundary = (pages: PageRow[], chapterNumber: number): ChapterBoundary | null => {
  const firstPage = pages[0].page_number;
  const lastPage = pages[pages.length - 1].page_number;
  const totalPages = lastPage - firstPage + 1;

  const partCount = Math.max(1, Math.min(SYNTHETIC_PART_MAX_COUNT, Math.floor(totalPages / SYNTHETIC_PART_MIN_PAGES)));
  if (chapterNumber > partCount) return null;

  const partSize = Math.ceil(totalPages / partCount);
  const startPage = firstPage + (chapterNumber - 1) * partSize;
  const endPage = Math.min(lastPage, startPage + partSize - 1);
  if (startPage > lastPage) return null;

  return {
    chapterNumber,
    chapterLabel: String(chapterNumber),
    chapterTitle: partCount === 1 ? 'Full document' : `Part ${chapterNumber} of ${partCount}`,
    startPage,
    endPage,
    headingMatches: [],
    synthesized: true
  };
};

export const findChapterBoundary = async (
  documentId: string,
  request: ChapterRequest
): Promise<ChapterBoundary | null> => {
  const db = getDatabase();
  const pageResult = await db.query(
    `SELECT page_number, text
     FROM document_pages
     WHERE document_id = $1
     ORDER BY page_number ASC`,
    [documentId]
  );
  const pages = pageResult.rows as PageRow[];
  if (!pages.length || !request.chapterNumber) return null;

  const headings = collectHeadings(pages);
  const sameNumber = headings.filter((heading) => heading.number === request.chapterNumber);
  if (!sameNumber.length) {
    // Only fall back when the document has no chapter structure at all; a missing
    // number in a document that *does* have headings is a genuine "no such chapter".
    return headings.length ? null : synthesizeBoundary(pages, request.chapterNumber);
  }

  const ranked = [...sameNumber].sort((a, b) => scoreHeading(b, request) - scoreHeading(a, request));
  // Prefer non-TOC body heading; fall back to best overall.
  const startHeading = ranked.find((heading) => !heading.onTocPage) || ranked[0];

  const nextNumber = request.chapterNumber + 1;
  const nextCandidates = headings.filter(
    (heading) =>
      heading.number === nextNumber &&
      !heading.onTocPage &&
      (heading.page > startHeading.page || (heading.page === startHeading.page && heading.index > startHeading.index))
  );
  const nextHeading =
    nextCandidates.sort((a, b) => a.page - b.page)[0] ||
    headings.find(
      (heading) =>
        !heading.onTocPage &&
        heading.number > startHeading.number &&
        heading.page > startHeading.page
    );

  const maxPage = pages[pages.length - 1].page_number;
  let endPage = nextHeading ? nextHeading.page - 1 : maxPage;
  if (endPage < startHeading.page) endPage = startHeading.page;

  // If boundary collapsed to one page, extend until next non-TOC higher chapter appears.
  if (endPage === startHeading.page) {
    const later = headings.find(
      (heading) => !heading.onTocPage && heading.number > startHeading.number && heading.page > startHeading.page
    );
    endPage = later ? later.page - 1 : Math.min(maxPage, startHeading.page + 8);
    if (endPage < startHeading.page) endPage = startHeading.page;
  }

  return {
    chapterNumber: startHeading.number,
    chapterLabel: startHeading.label,
    chapterTitle: startHeading.title,
    startPage: startHeading.page,
    endPage,
    headingMatches: sameNumber.map((item) => `${item.label}. ${item.title} (p.${item.page}${item.onTocPage ? ', toc' : ''})`)
  };
};

export const loadChapterPages = async (documentId: string, startPage: number, endPage: number) => {
  const db = getDatabase();
  const result = await db.query(
    `SELECT page_number, text
     FROM document_pages
     WHERE document_id = $1
       AND page_number BETWEEN $2 AND $3
     ORDER BY page_number ASC`,
    [documentId, startPage, endPage]
  );
  return result.rows as PageRow[];
};

export const loadChapterChunks = async (documentId: string, startPage: number, endPage: number) => {
  const db = getDatabase();
  const result = await db.query(
    `SELECT id, page_number, chunk_index, content
     FROM document_chunks
     WHERE document_id = $1
       AND page_number BETWEEN $2 AND $3
     ORDER BY page_number ASC, chunk_index ASC`,
    [documentId, startPage, endPage]
  );
  return result.rows as Array<{ id: string; page_number: number; chunk_index: number; content: string }>;
};

export const listDocumentChapters = async (documentId: string) => {
  const db = getDatabase();
  const pages = await db.query(
    `SELECT page_number, text
     FROM document_pages
     WHERE document_id = $1
     ORDER BY page_number ASC
     LIMIT 40`,
    [documentId]
  );

  const headings = collectHeadings(pages.rows as PageRow[]);

  // Prefer dense TOC pages + Roman chapter markers (avoids verse numbers like "26. ...").
  const tocRoman = headings.filter((heading) => heading.onTocPage && heading.isRoman);
  const titledRoman = headings.filter(
    (heading) =>
      heading.isRoman &&
      (/^An Account\b/i.test(heading.title) ||
        /^The Collecting\b/i.test(heading.title) ||
        /^The Way\b/i.test(heading.title) ||
        /^An Account Of\b/i.test(heading.title))
  );
  const allRoman = headings.filter((heading) => heading.isRoman);
  const pool =
    tocRoman.length >= 5
      ? tocRoman
      : titledRoman.length >= 5
        ? titledRoman
        : allRoman.length >= 3
          ? allRoman
          : headings.filter((heading) => heading.onTocPage);

  const byNumber = new Map<number, HeadingHit>();
  for (const heading of pool) {
    const existing = byNumber.get(heading.number);
    const betterTitle =
      !existing ||
      (heading.onTocPage && !existing.onTocPage) ||
      (heading.title.length < existing.title.length && /^An Account|The |Of /i.test(heading.title));
    if (betterTitle) {
      byNumber.set(heading.number, {
        ...heading,
        title: cleanHeadingTitle(heading.title)
      });
    }
  }

  return Array.from(byNumber.values())
    .filter((chapter) => looksLikeChapterTitle(chapter.title))
    .sort((a, b) => a.number - b.number)
    .slice(0, 40);
};

export const tryChapterList = async (documentId: string, query: string) => {
  const text = query.trim().toLowerCase();
  const wantsList =
    (/list|all|names|contents|toc|table of contents|index|what chapters|which chapters|chapters (in|of|found)/i.test(text) &&
      /chapter|section|contents|toc/i.test(text)) ||
    /give me (all )?(the )?chapters?/i.test(text);

  if (!wantsList) return null;
  if (/\b(explain|detail|graph|mind map|summarize|teach|about chapter\s+\d)/i.test(text)) return null;

  const chapters = await listDocumentChapters(documentId);
  if (!chapters.length) {
    return {
      type: 'TEXT_RESPONSE' as const,
      intent: 'CHAPTER_LIST' as const,
      answer: 'I could not find a clear table of contents in this document yet. Try asking about a specific chapter title.',
      sources: []
    };
  }

  const lines = chapters.map((chapter) => `- **${chapter.label}. ${chapter.title}**`);
  const pages = Array.from(new Set(chapters.map((chapter) => chapter.page))).sort((a, b) => a - b);

  return {
    type: 'TEXT_RESPONSE' as const,
    intent: 'CHAPTER_LIST' as const,
    answer: [
      '## Table of contents',
      '',
      `I found **${chapters.length} chapters** in this document:`,
      '',
      ...lines,
      '',
      'Ask about any chapter for a detailed explanation — for example: **Explain Chapter I**.',
      'You can also request a concept graph: **Create a graph for Chapter 1**.'
    ].join('\n'),
    sources: pages.slice(0, 6).map((page) => ({
      documentId,
      pageNumber: page,
      sourceText: `Page ${page}`
    })),
    meta: {
      type: 'CHAPTER_LIST',
      chapterCount: chapters.length
    }
  };
};
