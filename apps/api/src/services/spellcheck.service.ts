import { getDatabase } from '../utils/database.utils.js';
import { foldDiacritics } from './exact.extract.js';

export type SpellCorrection = {
  from: string;
  to: string;
};

export type SpellCheckResult = {
  original: string;
  corrected: string;
  changed: boolean;
  corrections: SpellCorrection[];
};

type Vocabulary = {
  counts: Map<string, number>;
  /** Words bucketed by length so candidate lookup stays cheap. */
  byLength: Map<number, string[]>;
  /** Adjacent word pairs, used to pick the candidate that fits the question. */
  bigrams: Set<string>;
};

const VOCAB_TTL_MS = 10 * 60 * 1000;
const MIN_WORD_LENGTH = 3;
/** Caps so a large book cannot pin an unbounded index in memory. */
const MAX_BIGRAMS = 250_000;
const MAX_CACHED_DOCUMENTS = 4;
/** Distinct words a document needs before its wording is trusted as a dictionary. */
const RELIABLE_VOCABULARY = 2500;

const vocabularyCache = new Map<string, { vocabulary: Vocabulary; updatedAt: number }>();

/**
 * Words a reader uses to ask about a document. They are seeded into every
 * vocabulary so an ordinary question word is never "corrected" into some
 * unrelated term the document happens to contain.
 */
const COMMON_WORDS = [
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'about', 'after', 'before', 'between', 'during', 'from', 'into', 'over', 'under',
  'explain', 'explanation', 'describe', 'summarize', 'summarise', 'summary', 'compare',
  'define', 'definition', 'analyse', 'analyze', 'analysis', 'outline', 'discuss',
  'chapter', 'chapters', 'section', 'sections', 'page', 'pages', 'document', 'book',
  'text', 'list', 'give', 'show', 'tell', 'mean', 'meaning', 'example', 'examples',
  'difference', 'differences', 'similar', 'important', 'according', 'happens', 'happen',
  'concept', 'concepts', 'graph', 'chart', 'diagram', 'map', 'main', 'idea', 'ideas',
  'theme', 'themes', 'topic', 'topics', 'subject', 'author', 'title', 'story',
  'please', 'detail', 'details', 'overview', 'point', 'points', 'question', 'questions',
  'answer', 'reason', 'reasons', 'purpose', 'result', 'results', 'process', 'steps',
  'first', 'second', 'third', 'last', 'next', 'between', 'without', 'within',
  'create', 'make', 'find', 'know', 'think', 'need', 'want', 'help', 'read',
  'short', 'long', 'brief', 'simple', 'quick', 'best', 'better', 'more', 'less',
  'key', 'part', 'parts', 'type', 'types', 'kind', 'name', 'names', 'number'
];

/**
 * Function words carry no collocation signal: "like and" is a common pair in
 * any English text, so allowing "and" as context would endorse the wrong
 * candidate. Only content words are used to judge whether a candidate fits.
 */
const FUNCTION_WORDS = new Set([
  'the', 'and', 'for', 'but', 'nor', 'yet', 'that', 'this', 'these', 'those',
  'with', 'from', 'into', 'onto', 'upon', 'over', 'under', 'about', 'after',
  'before', 'between', 'during', 'through', 'above', 'below', 'out', 'off',
  'are', 'was', 'were', 'been', 'being', 'has', 'have', 'had', 'his', 'her',
  'hers', 'its', 'their', 'them', 'they', 'you', 'your', 'yours', 'our', 'ours',
  'him', 'she', 'not', 'nor', 'all', 'any', 'some', 'such', 'than', 'then',
  'there', 'here', 'too', 'very', 'can', 'will', 'shall', 'would', 'should',
  'could', 'may', 'might', 'must', 'does', 'did', 'done', 'also', 'only',
  'own', 'same', 'other', 'more', 'most', 'both', 'each', 'few', 'one', 'two',
  'who', 'whom', 'what', 'when', 'where', 'why', 'how', 'which', 'while',
  'thou', 'thy', 'thee', 'unto', 'hath', 'doth'
]);

const isContextWord = (word: string) => word.length >= 3 && !FUNCTION_WORDS.has(word);

const tokenPattern = /[\p{L}][\p{L}'’-]*/gu;

const normalize = (word: string) => word.toLowerCase().replace(/[’']/g, "'");

/**
 * Damerau-Levenshtein distance that bails out once it exceeds `max`. Swapped
 * letters ("waht" for "what") are the most common typing mistake, so they must
 * cost one edit rather than two.
 */
const boundedEditDistance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  let twoAgo = new Array<number>(b.length + 1);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      let value = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoAgo[j - 2] + 1);
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > max) return max + 1;
    const spare = twoAgo;
    twoAgo = previous;
    previous = current;
    current = spare;
  }

  return previous[b.length];
};

/** Tighter budget for short words, where one edit already changes the meaning. */
const maxDistanceFor = (word: string) => {
  if (word.length <= 4) return 1;
  if (word.length <= 7) return 2;
  return 2;
};

const buildVocabulary = async (documentId: string): Promise<Vocabulary> => {
  const result = await getDatabase().query(
    'SELECT content FROM document_chunks WHERE document_id = $1',
    [documentId]
  );

  const counts = new Map<string, number>();
  const bigrams = new Set<string>();
  for (const row of result.rows as Array<{ content: string }>) {
    const matches = row.content?.match(tokenPattern);
    if (!matches) continue;

    let previousWord = '';
    for (const match of matches) {
      const parts = foldDiacritics(normalize(match)).split(/[^a-z]+/).filter((part) => part.length >= MIN_WORD_LENGTH);
      for (const word of parts) {
        if (previousWord && bigrams.size < MAX_BIGRAMS) bigrams.add(`${previousWord} ${word}`);
        previousWord = word;
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
  }

  for (const word of COMMON_WORDS) {
    if (!counts.has(word)) counts.set(word, 1);
  }

  const byLength = new Map<number, string[]>();
  for (const word of counts.keys()) {
    const bucket = byLength.get(word.length);
    if (bucket) bucket.push(word);
    else byLength.set(word.length, [word]);
  }

  return { counts, byLength, bigrams };
};

const getVocabulary = async (documentId: string): Promise<Vocabulary> => {
  const cached = vocabularyCache.get(documentId);
  if (cached && Date.now() - cached.updatedAt < VOCAB_TTL_MS) return cached.vocabulary;

  const vocabulary = await buildVocabulary(documentId);
  vocabularyCache.set(documentId, { vocabulary, updatedAt: Date.now() });

  while (vocabularyCache.size > MAX_CACHED_DOCUMENTS) {
    const oldest = vocabularyCache.keys().next().value;
    if (oldest === undefined) break;
    vocabularyCache.delete(oldest);
  }

  return vocabulary;
};

export const invalidateVocabulary = (documentId: string) => {
  vocabularyCache.delete(documentId);
};

/** True when the regular plural of `stem` is "es" rather than a bare "s". */
const takesEsPlural = (stem: string) => /(?:y|s|x|z|ch|sh)$/.test(stem);

/**
 * Regular inflections of `word`, e.g. ritual -> rituals, ritualed. Forms built
 * off a trimmed stem ("explaine" -> "explained") are deliberately excluded:
 * they would certify misspellings as valid words.
 */
const inflectionsOf = (word: string) => {
  const forms = [`${word}ed`, `${word}ing`, `${word}'s`];
  forms.push(takesEsPlural(word) ? `${word}es` : `${word}s`);
  if (word.endsWith('y')) forms.push(`${word.slice(0, -1)}ies`);
  return forms;
};

/** Stems `word` could be an inflection of, e.g. created -> create. */
const stemsOf = (word: string) => {
  const stems: string[] = [];
  for (const suffix of ['ed', 'ing', "'s", 'd']) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) {
      const stem = word.slice(0, -suffix.length);
      stems.push(stem, `${stem}e`);
    }
  }
  if (word.endsWith('ies')) stems.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) stems.push(word.slice(0, -2));
  // A bare "s" plural only implies the stem when the stem takes that plural,
  // so "ceremonys" stays a typo for "ceremonies" rather than a valid variant.
  if (word.endsWith('s') && !word.endsWith('ss')) {
    const stem = word.slice(0, -1);
    if (!takesEsPlural(stem)) stems.push(stem);
  }
  return stems;
};

/**
 * A plural or tense the document happens not to use is not a misspelling, so
 * treat those as known rather than "correcting" them back to some other word.
 */
const isKnownVariant = (word: string, vocabulary: Vocabulary) =>
  inflectionsOf(word).some((form) => vocabulary.counts.has(form)) ||
  stemsOf(word).some((stem) => vocabulary.counts.has(stem));

type Match = {
  word: string;
  distance: number;
  count: number;
  fitsContext: boolean;
  prefix: number;
  transposed: boolean;
};

const commonPrefixLength = (a: string, b: string) => {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
};

/** True when `b` is `a` with one pair of neighbouring letters swapped. */
const isTransposition = (a: string, b: string) => {
  if (a.length !== b.length) return false;

  const differing: number[] = [];
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    differing.push(index);
    if (differing.length > 2) return false;
  }

  const [first, second] = differing;
  return (
    differing.length === 2 &&
    second === first + 1 &&
    a[first] === b[second] &&
    a[second] === b[first]
  );
};

/**
 * Candidates are ranked by closeness, then by how plausible the mistake is,
 * and only last by frequency. Frequency alone turns "yama loke" into "yama
 * like", because the common English word outnumbers the rare term the reader
 * meant. A swapped pair of letters is the most common typing slip, so it wins
 * first ("waht" is "what", not "wait"); after that the longest shared prefix
 * wins, since typos land late in a word far more often than in its opening
 * letters.
 */
const isBetter = (candidate: Match, best: Match | null) => {
  if (!best) return true;
  if (candidate.distance !== best.distance) return candidate.distance < best.distance;
  if (candidate.transposed !== best.transposed) return candidate.transposed;
  if (candidate.prefix !== best.prefix) return candidate.prefix > best.prefix;
  if (candidate.fitsContext !== best.fitsContext) return candidate.fitsContext;
  return candidate.count > best.count;
};

const findBestMatch = (
  word: string,
  vocabulary: Vocabulary,
  previousWord: string,
  nextWord: string,
  strict: boolean
): Match | null => {
  const maxDistance = maxDistanceFor(word);
  let best: Match | null = null;

  for (let length = word.length - maxDistance; length <= word.length + maxDistance; length += 1) {
    for (const candidate of vocabulary.byLength.get(length) ?? []) {
      // A different first letter is usually a different word, not a typo.
      if (candidate[0] !== word[0] && candidate.length === word.length) continue;

      // "rebirth" is not a misspelling of "birth": dropping a whole prefix or
      // suffix produces a different word rather than fixing a slip.
      const lengthGap = Math.abs(candidate.length - word.length);
      if (lengthGap >= 2 && (word.includes(candidate) || candidate.includes(word))) continue;

      const distance = boundedEditDistance(word, candidate, maxDistance);
      if (distance > maxDistance) continue;

      // Two edits that also rewrite the opening letters describe a different
      // word, not a slip: "pinda" is not a misspelling of "mind".
      const prefix = commonPrefixLength(word, candidate);
      if (distance > 1 && prefix < 2) continue;

      const fitsContext =
        (previousWord !== '' && vocabulary.bigrams.has(`${previousWord} ${candidate}`)) ||
        (nextWord !== '' && vocabulary.bigrams.has(`${candidate} ${nextWord}`));

      const count = vocabulary.counts.get(candidate) ?? 0;
      const match = {
        word: candidate,
        distance,
        count,
        fitsContext,
        prefix,
        transposed: isTransposition(word, candidate)
      };
      if (isBetter(match, best)) best = match;
    }
  }

  if (!best) return null;

  // A single sighting is often OCR noise; demand corroboration for weaker matches.
  if (best.distance > 1 && best.count < 2 && !best.fitsContext) return null;

  // In a short document, a missing word usually means the document simply never
  // uses it, not that the reader mistyped it. Only unmistakable slips — a
  // swapped pair, or a word that matches to its final letter — are corrected.
  if (strict) {
    const unmistakable = best.transposed || best.prefix >= word.length - 1;
    if (best.distance > 1 || !unmistakable || best.count < 2) return null;
  }

  return best;
};

/** Preserve the shape the user typed (ALL CAPS, Title Case, lower). */
const matchCasing = (original: string, replacement: string) => {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

/**
 * Correct query typos against the document's own wording. A general-purpose
 * dictionary would "fix" domain terms (Yama Loka, Purusha) into English words,
 * so the document text is the only trustworthy reference here.
 */
export const correctQuerySpelling = async (
  documentId: string,
  query: string
): Promise<SpellCheckResult> => {
  const base: SpellCheckResult = { original: query, corrected: query, changed: false, corrections: [] };
  if (!query || query.trim().length < MIN_WORD_LENGTH) return base;

  let vocabulary: Vocabulary;
  try {
    vocabulary = await getVocabulary(documentId);
  } catch {
    return base;
  }
  if (!vocabulary.counts.size) return base;

  const strict = vocabulary.counts.size < RELIABLE_VOCABULARY;
  const tokens = Array.from(query.matchAll(tokenPattern));
  const words = tokens.map((token) => normalize(token[0]));
  const resolved = [...words];
  const corrections: SpellCorrection[] = [];

  let corrected = '';
  let cursor = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const word = words[index];
    const start = token.index ?? 0;
    corrected += query.slice(cursor, start);
    cursor = start + token[0].length;

    if (word.length < MIN_WORD_LENGTH || vocabulary.counts.has(word) || isKnownVariant(word, vocabulary)) {
      corrected += token[0];
      continue;
    }

    const foldedWord = foldDiacritics(word).replace(/[^a-z]/g, '');
    if (foldedWord !== word && vocabulary.counts.has(foldedWord)) {
      corrected += token[0];
      continue;
    }

    // Compare against the already-corrected neighbour so one fix can support the next.
    const previous = index > 0 ? resolved[index - 1] : '';
    const next = words[index + 1] ?? '';
    const match = findBestMatch(
      word,
      vocabulary,
      isContextWord(previous) ? previous : '',
      isContextWord(next) ? next : '',
      strict
    );
    if (!match) {
      corrected += token[0];
      continue;
    }

    // Domain tokens must not be rewritten into ordinary English
    // ("kund" → "kind", "loka" → "like", "and" from a truncated word).
    const commonTarget =
      COMMON_WORDS.includes(match.word) || FUNCTION_WORDS.has(match.word);
    const commonSource = COMMON_WORDS.includes(word) || FUNCTION_WORDS.has(word);
    if (commonTarget && !commonSource && !match.transposed) {
      corrected += token[0];
      continue;
    }
    if (word.length <= 4 && !match.transposed && match.prefix < 2) {
      corrected += token[0];
      continue;
    }

    resolved[index] = match.word;
    const replacement = matchCasing(token[0], match.word);
    corrections.push({ from: token[0], to: replacement });
    corrected += replacement;
  }

  corrected += query.slice(cursor);

  if (!corrections.length) return base;
  return { original: query, corrected, changed: true, corrections };
};
