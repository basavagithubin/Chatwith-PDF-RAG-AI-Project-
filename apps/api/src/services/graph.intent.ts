import { GraphRequest, GraphType } from './graph.types.js';

const ROMAN_MAP: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15
};

const toRoman = (value: number) => {
  const entry = Object.entries(ROMAN_MAP).find(([, number]) => number === value);
  return entry?.[0]?.toUpperCase() || String(value);
};

const parseChapterToken = (token: string) => {
  const cleaned = token.trim().toLowerCase();
  if (/^\d+$/.test(cleaned)) {
    const number = Number(cleaned);
    return { chapterNumber: number, chapterLabel: toRoman(number) };
  }
  if (ROMAN_MAP[cleaned]) {
    return { chapterNumber: ROMAN_MAP[cleaned], chapterLabel: cleaned.toUpperCase() };
  }
  if (WORD_NUMBERS[cleaned]) {
    const number = WORD_NUMBERS[cleaned];
    return { chapterNumber: number, chapterLabel: toRoman(number) };
  }
  return null;
};

const detectGraphType = (query: string): GraphType => {
  const text = query.toLowerCase();
  if (/timeline|chronolog|sequence of events/.test(text)) return 'timeline';
  if (/cause\s*(and|&)?\s*effect|causal/.test(text)) return 'cause_effect';
  if (/mind\s*map/.test(text)) return 'mind_map';
  if (/hierarch/.test(text)) return 'hierarchy';
  return 'concept_map';
};

const GRAPH_PATTERN =
  /\b(graph|diagram|visualize|visualise|concept\s*map|mind\s*map|knowledge\s*graph|timeline|chronolog|cause\s*(and|&)?\s*effect|relationships?\s+in|show\s+(me\s+)?(the\s+)?relationships|how\s+(the\s+)?concepts\s+are\s+connected)\b/i;

export const detectGraphRequest = (query: string): GraphRequest | null => {
  const text = query.trim();
  if (!text || !GRAPH_PATTERN.test(text)) return null;

  const graphType = detectGraphType(text);

  const chapterMatch =
    text.match(/\b(?:chapter|ch\.?)\s*([ivxlc]+|\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i) ||
    text.match(/\b([ivxlc]+)\.\s+[A-Z]/i);

  if (!chapterMatch) {
    // Graph without explicit chapter: still allow if "this chapter" / "the chapter"
    if (/\b(this|the)\s+chapter\b/i.test(text) || /\bimportant concepts\b/i.test(text)) {
      return {
        type: 'GRAPH_GENERATION',
        graphType,
        chapterNumber: 1,
        chapterLabel: 'I',
        rawQuery: text
      };
    }
    return null;
  }

  const parsed = parseChapterToken(chapterMatch[1]);
  if (!parsed) return null;

  const titleHint = text.match(/\b[ivxlc]+\.\s+([A-Za-z0-9'’:,\- ]{4,90})/i)?.[1]?.trim();

  return {
    type: 'GRAPH_GENERATION',
    graphType,
    chapterNumber: parsed.chapterNumber,
    chapterLabel: parsed.chapterLabel,
    chapterTitleHint: titleHint,
    rawQuery: text
  };
};
