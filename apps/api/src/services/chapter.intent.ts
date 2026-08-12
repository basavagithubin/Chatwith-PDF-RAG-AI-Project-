import { ChapterMode, ChapterRequest } from './chapter.types.js';

const ROMAN_MAP: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
  xxi: 21, xxii: 22, xxiii: 23, xxiv: 24, xxv: 25
};

const toRoman = (value: number) => {
  const entry = Object.entries(ROMAN_MAP).find(([, number]) => number === value);
  return entry?.[0]?.toUpperCase();
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15
};

const parseChapterToken = (token: string) => {
  const cleaned = token.trim().toLowerCase();
  if (/^\d+$/.test(cleaned)) {
    const number = Number(cleaned);
    return { chapterNumber: number, chapterLabel: toRoman(number) || String(number) };
  }
  if (ROMAN_MAP[cleaned]) {
    return { chapterNumber: ROMAN_MAP[cleaned], chapterLabel: cleaned.toUpperCase() };
  }
  if (WORD_NUMBERS[cleaned]) {
    const number = WORD_NUMBERS[cleaned];
    return { chapterNumber: number, chapterLabel: toRoman(number) || String(number) };
  }
  return null;
};

const detectMode = (query: string): ChapterMode => {
  const text = query.toLowerCase();
  if (/compare|difference|vs\.?|versus/.test(text)) return 'compare';
  if (/exam|revision|revise|notes for exam|possible questions/.test(text)) return 'exam';
  if (/teach me|teach|learn|progressive|from basics/.test(text)) return 'teach';
  if (/important points|key points|key takeaways|most important/.test(text)) return 'points';
  if (/short summary|brief summary|concise/.test(text)) return 'short';
  if (/summarize|summary/.test(text)) return 'summarize';
  return 'explain';
};

export const detectChapterRequest = (query: string): ChapterRequest | null => {
  const text = query.trim();
  if (!text) return null;

  const mode = detectMode(text);

  if (/\b(all chapters|chapter names|list.*chapters|table of contents)\b/i.test(text)) {
    return null;
  }

  const compareMatch = text.match(
    /compare\s+(?:chapter|ch\.?)?\s*([ivxlc]+|\d{1,2})\s+(?:and|with|vs\.?|versus)\s+(?:chapter|ch\.?)?\s*([ivxlc]+|\d{1,2})/i
  );
  if (compareMatch) {
    const left = parseChapterToken(compareMatch[1]);
    const right = parseChapterToken(compareMatch[2]);
    if (left && right) {
      return {
        type: 'CHAPTER_ANALYSIS',
        mode: 'compare',
        chapterNumber: left.chapterNumber,
        chapterLabel: left.chapterLabel,
        compareWith: {
          chapterNumber: right.chapterNumber,
          chapterLabel: right.chapterLabel
        },
        rawQuery: text
      };
    }
  }

  const titled = text.match(/\b([ivxlc]+)\.\s+([A-Za-z0-9'’:,\- ]{4,90})/i);
  if (titled && /\b(explain|detail|summar|point|teach|understand|about|account|exam)\b/i.test(text)) {
    const parsed = parseChapterToken(titled[1]);
    if (parsed) {
      return {
        type: 'CHAPTER_ANALYSIS',
        mode,
        chapterNumber: parsed.chapterNumber,
        chapterLabel: parsed.chapterLabel,
        chapterTitleHint: titled[2].replace(/\b(give me|detail|details|about it|everything|point|points|explain)\b/gi, ' ').replace(/\s+/g, ' ').trim(),
        rawQuery: text
      };
    }
  }

  const chapterMatch =
    text.match(/\b(?:chapter|ch\.?)\s*([ivxlc]+|\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i) ||
    text.match(/^\s*([ivxlc]+|\d{1,2})\s*$/i);

  if (!chapterMatch) return null;

  // Graph requests are handled by GRAPH_GENERATION, not chapter text analysis.
  if (/\b(graph|diagram|visualize|visualise|concept\s*map|mind\s*map|knowledge\s*graph)\b/i.test(text)) {
    return null;
  }

  const hasAnalysisVerb = /\b(explain|summarize|summary|teach|exam|points|understand|detail|about|what should i|revision|notes)\b/i.test(text)
    || /\bchapter\b/i.test(text);

  if (!hasAnalysisVerb) return null;

  const parsed = parseChapterToken(chapterMatch[1]);
  if (!parsed) return null;

  return {
    type: 'CHAPTER_ANALYSIS',
    mode,
    chapterNumber: parsed.chapterNumber,
    chapterLabel: parsed.chapterLabel,
    rawQuery: text
  };
};
