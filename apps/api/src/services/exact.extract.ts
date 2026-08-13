const WORD_COUNTS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

const LIST_STOP = new Set([
  'name', 'names', 'list', 'enumerate', 'mention', 'give', 'tell', 'what', 'which', 'are',
  'the', 'a', 'an', 'of', 'to', 'be', 'and', 'for', 'from', 'please', 'me', 'my', 'all',
  'exact', 'exactly', 'document', 'text', 'sloka', 'śloka', 'verse', 'verses'
]);

export type ExactIntent =
  | { type: 'list'; expectedCount?: number; topic: string; rawQuery: string }
  | { type: 'sloka'; topic: string; rawQuery: string };

export type NumberedItem = {
  n: number;
  sanskrit: string;
  english: string;
};

export type ExtractedList = {
  heading: string;
  items: NumberedItem[];
  sloka?: { verse: string; meaning: string };
  note?: string;
  pageNumber?: number;
};

const normalizeSpace = (value: string) => value.replace(/\s+/g, ' ').trim();

export const foldDiacritics = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[ṃṁ]/g, 'm')
    .toLowerCase();

const stripTrailingPunct = (value: string) => value.replace(/[–—\-:,;]+$/g, '').trim();

const titleCaseTopic = (value: string) => {
  const cleaned = normalizeSpace(value);
  if (!cleaned) return 'this topic';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

export const detectExactIntent = (query: string): ExactIntent | null => {
  const text = query.trim();
  if (!text) return null;
  if (/explain only item|do not enumerate|cite the page numbers|reply with page citations only/i.test(text)) {
    return null;
  }

  const slokaAsked = /\b(sloka|śloka|shlok|verse|mantra|sūtra|sutra)\b/i.test(text);
  const hasListVerb = /\b(name|list|enumerate|mention|what are|which are)\b/i.test(text);
  const countedNoun = /(?<!\b(?:page|chapter|ch|section|p)\s)(?:the\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?!page|chapter|section|about|from|with|that|this|give|detail)([A-Za-zāīūṛṅñṭḍṇśṣ]{3,})/i.test(
    text
  );
  const listAsked = hasListVerb || countedNoun;

  const countMatch =
    text.match(/\b(\d{1,2})\b/) ||
    text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  const expectedCount = countMatch
    ? WORD_COUNTS[countMatch[1].toLowerCase()] ?? Number(countMatch[1])
    : undefined;

  const topic = text
    .replace(/\b(name|list|enumerate|mention|what are|which are|give me|tell me|please|exact|exactly)\b/gi, ' ')
    .replace(/\b(the|a|an|of|to|be|controlled|control|from|document|text|sloka|śloka|verse)\b/gi, ' ')
    .replace(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, ' ')
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\b(chapters?|sections?|contents|table of contents|headings?)\b/i.test(text) &&
      !/\b(urges?|vices?|virtues?|symptoms?|exchanges?)\b/i.test(text)) {
    return slokaAsked ? { type: 'sloka', topic: topic || 'the verse', rawQuery: text } : null;
  }

  if (listAsked) {
    const distinctive = topic.split(/\s+/).filter((word) => word.length > 2 && !LIST_STOP.has(word.toLowerCase()));
    if (!distinctive.length && !expectedCount) return slokaAsked
      ? { type: 'sloka', topic: topic || 'the verse', rawQuery: text }
      : null;
    return {
      type: 'list',
      expectedCount: Number.isFinite(expectedCount) ? expectedCount : undefined,
      topic: topic || 'items',
      rawQuery: text
    };
  }

  if (slokaAsked) {
    return { type: 'sloka', topic: topic || 'the verse', rawQuery: text };
  }

  return null;
};

const looksLikeTocItem = (english: string) =>
  /to be (controlled|avoided|imbibed)|at a glance|contents|introduction|author'?s profile|loving exchanges|types of devotees/i.test(
    english
  );

const COMMON_SANSKRIT = new Set(['yo', 'sa', 'ca', 'na', 'hi', 'vai', 'tu', 'iti', 'yah', 'tat', 'te', 'etad']);

const looksLikeSanskrit = (value: string, loose = false) => {
  const token = value.trim();
  if (!token || token.length > 48) return false;
  if (/[āīūṛṝḷṃḥṅñṭḍṇśṣṁĀĪŪṚḶ]/.test(token)) return true;
  if (/-(vega[mṁ]?|vegān|krodha|jihvā|upastha)/i.test(token)) return true;
  if (COMMON_SANSKRIT.has(token.toLowerCase())) return true;
  if (loose && /^[a-zA-Z]{3,18}$/.test(token) && token === token.toLowerCase()) return true;
  return false;
};

const looksLikeSectionHeading = (english: string) => {
  const value = english.trim();
  if (looksLikeTocItem(value)) return true;
  const letters = value.replace(/[^A-Za-zĀ-ẓ]/g, '');
  if (letters.length >= 10 && value === value.toUpperCase() && /to be |urges to|vices to|virtues to/i.test(value)) {
    return true;
  }
  return letters.length >= 12 && value === value.toUpperCase() && !/\b(urge|speech|mind|anger|tongue|belly)\b/i.test(value);
};

const parseNumberedLine = (line: string): NumberedItem | null => {
  const cleaned = line.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const match = cleaned.match(
    /^(?:([^\d]{2,48}?)\s*-?\s*)?(\d{1,2})[a-z]?[.)]\s+(.{3,160})$/i
  );
  if (!match) return null;
  const n = Number(match[2]);
  if (n < 1 || n > 20) return null;
  const sanskrit = stripTrailingPunct(match[1] || '');
  const english = normalizeSpace(match[3]);
  if (english.length < 3) return null;
  if (!sanskrit && looksLikeSectionHeading(english)) return null;
  if (sanskrit && !looksLikeSanskrit(sanskrit, true) && sanskrit.split(' ').length > 4) return null;
  return {
    n,
    sanskrit: looksLikeSanskrit(sanskrit, true) ? sanskrit : '',
    english: english.slice(0, 140)
  };
};

const extractFromLines = (text: string): NumberedItem[] => {
  const items: NumberedItem[] = [];
  let pending: NumberedItem | null = null;
  const flush = () => {
    if (pending) items.push(pending);
    pending = null;
  };

  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    const parsed = parseNumberedLine(line);
    if (parsed) {
      flush();
      pending = parsed;
      continue;
    }
    if (pending && line.length > 1 && line.length < 90 && !/^\d+[a-z]?[.)]/i.test(line)) {
      if (/^(etān|etan|vāco|vaco|yo |sarvām|pṛthivī|sadbhir|ṣaḍbhir)/i.test(line)) continue;
      const incomplete = /\b(for|to|of|and|or|a|an|the)$/i.test(pending.english) || pending.english.split(/\s+/).length < 5;
      if (!incomplete) continue;
      const tokens = line.split(/\s+/);
      const sk = tokens.filter((token) => looksLikeSanskrit(token.replace(/[–—,]$/, '')));
      if (sk.length >= 2) continue;
      const rest = tokens.filter((token) => !sk.includes(token)).join(' ').trim();
      if (sk.length === 1 && !pending.sanskrit) {
        pending.sanskrit = stripTrailingPunct(sk[0]);
      } else if (sk.length === 1) {
        pending.sanskrit = stripTrailingPunct(`${pending.sanskrit} ${sk[0]}`);
      }
      if (rest && !looksLikeSectionHeading(rest)) {
        pending.english = normalizeSpace(`${pending.english} ${rest}`);
      }
    }
  }
  flush();
  return items;
};

/** Collapsed PDF chunks lose newlines; recover "sanskrit N. english" rows. */
const extractFromCollapsed = (text: string): NumberedItem[] => {
  const source = ` ${normalizeSpace(text)} `;
  const pattern =
    /(?:^|\s)([^\s\d][^0-9]{0,40}?)?\s*-?\s*(\d{1,2})[.)]\s+([^0-9]+?)(?=\s+[^\s\d][^0-9]{0,40}?\s*-?\s*\d{1,2}[.)]|\s*$)/g;
  const items: NumberedItem[] = [];
  for (const match of source.matchAll(pattern)) {
    const parsed = parseNumberedLine(`${match[1] || ''} ${match[2]}. ${match[3]}`);
    if (parsed) items.push(parsed);
  }
  return items;
};

const groupSequences = (items: NumberedItem[]): NumberedItem[][] => {
  const groups: NumberedItem[][] = [];
  let current: NumberedItem[] = [];
  for (const item of items) {
    if (!current.length) {
      current = [item];
      continue;
    }
    const last = current[current.length - 1];
    if (item.n === last.n + 1 || (item.n === 1 && current.length >= 2)) {
      if (item.n === 1 && current.length >= 2) {
        groups.push(current);
        current = [item];
      } else {
        current.push(item);
      }
    } else if (item.n === last.n) {
      last.english = normalizeSpace(`${last.english}; ${item.english}`);
      if (item.sanskrit && !last.sanskrit.includes(item.sanskrit)) {
        last.sanskrit = stripTrailingPunct(`${last.sanskrit} ${item.sanskrit}`);
      }
    } else {
      groups.push(current);
      current = [item];
    }
  }
  if (current.length) groups.push(current);
  return groups.filter((group) => group.length >= 2);
};

const nearbyHeading = (text: string, snippet: string) => {
  const idx = text.toLowerCase().indexOf(snippet.slice(0, 40).toLowerCase());
  const window = idx >= 0 ? text.slice(Math.max(0, idx - 220), idx) : text.slice(0, 220);
  const candidates = [
    window.match(/\d{1,2}\.\s+([A-Z][^\n]{6,80})/)?.[1],
    window.match(/([A-Z][A-Z0-9ĀĪŪṚḶṂḤṄÑṬḌṆŚṢ'’:,\- ]{8,80})/)?.[1],
    window.split('\n').map((line) => line.trim()).filter((line) => line.length > 8 && !/^\d+\.?$/.test(line)).slice(-1)[0]
  ]
    .map((value) => normalizeSpace(value || ''))
    .filter((value) => value.length > 4 && !/^\d+\.?$/.test(value));
  return (candidates[0] || '').slice(0, 90);
};

const topicTermList = (topic: string) =>
  Array.from(
    new Set(
      topic
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .flatMap((word) => (word.endsWith('s') && word.length > 4 ? [word, word.slice(0, -1)] : [word]))
    )
  );

const scoreGroup = (group: NumberedItem[], intent: ExactIntent, heading: string) => {
  const topicTerms = topicTermList(intent.topic);
  const hay = foldDiacritics(`${heading} ${group.map((item) => `${item.sanskrit} ${item.english}`).join(' ')}`);
  let score = group.length * 2;
  for (const term of topicTerms) {
    if (hay.includes(foldDiacritics(term))) score += 8;
  }
  const itemHits = group.filter((item) =>
    topicTerms.some((term) => foldDiacritics(`${item.sanskrit} ${item.english}`).includes(foldDiacritics(term)))
  ).length;
  if (itemHits >= Math.max(2, Math.ceil(group.length / 3))) score += 14;
  if (group[0]?.n === 1) score += 8;
  else score -= 24;
  if (intent.type === 'list' && intent.expectedCount && group.length === intent.expectedCount) score += 18;
  if (intent.type === 'list' && intent.expectedCount && Math.abs(group.length - intent.expectedCount) > 2) score -= 8;
  if (group.filter((item) => item.sanskrit).length >= Math.ceil(group.length / 2)) score += 10;
  if (group.every((item) => looksLikeTocItem(item.english))) score -= 28;
  if (group.some((item) => looksLikeTocItem(item.english))) score -= 10;
  const headingFold = foldDiacritics(heading);
  if (/contents|at a glance|author'?s profile/.test(headingFold)) score -= 24;
  if (topicTerms.some((term) => headingFold.includes(foldDiacritics(term)))) score += 28;
  if (topicTerms.length && !topicTerms.some((term) => hay.includes(foldDiacritics(term)))) score -= 20;
  return score;
};

const extractCompactList = (text: string, intent: ExactIntent): ExtractedList | null => {
  if (intent.type !== 'list' || !intent.expectedCount) return null;
  const countWord =
    Object.keys(WORD_COUNTS).find((key) => WORD_COUNTS[key] === intent.expectedCount) || String(intent.expectedCount);
  const topic = intent.topic.replace(/\s+/g, '[\\s\\w]{0,20}');
  const pattern = new RegExp(
    `(?:${intent.expectedCount}|${countWord})[\\s\\w]{0,24}${topic}[^\\n]{0,40}[–—\\-]\\s*(?:of\\s+)?([^\\n.]{10,180})`,
    'i'
  );
  const blob = text.replace(/\n+/g, ' ');
  const match = blob.match(pattern);
  if (!match?.[1]) return null;
  const parts = match[1]
    .split(/\s*(?:,|&| and )\s*/i)
    .map((part) => normalizeSpace(part.replace(/^of\s+/i, '')))
    .filter((part) => part.length > 2 && part.length < 60);
  if (parts.length < (intent.expectedCount || 3)) return null;
  return {
    heading: titleCaseTopic(intent.topic),
    items: parts.slice(0, intent.expectedCount).map((english, index) => ({
      n: index + 1,
      sanskrit: '',
      english: english.replace(/\.$/, '')
    })),
    note: 'Listed from the document summary.'
  };
};

const extractSlokaFromText = (text: string, afterSnippet?: string) => {
  const start = afterSnippet
    ? text.toLowerCase().indexOf(afterSnippet.slice(0, 40).toLowerCase())
    : 0;
  const source = start >= 0 ? text.slice(start + Math.min(afterSnippet?.length || 0, 80)) : text;
  const lines = source.split(/\n/).map((line) => line.trim()).filter(Boolean).slice(0, 12);
  const verseParts: string[] = [];
  const meaningParts: string[] = [];
  for (const line of lines) {
    if (/^(when one|tapasya|direct bhakti|approaching|the six)/i.test(line)) {
      if (meaningParts.length) break;
    }
    if (/^\d+[.)]/.test(line)) continue;
    const tokens = line.split(/\s+/);
    const sanskritTokens = tokens.filter((token) => looksLikeSanskrit(token.replace(/[–—,]$/, '')) && token.length >= 2);
    if (sanskritTokens.length >= 2 && /[āīūṛṃḥṅñṭḍṇśṣṁ]/.test(line)) {
      verseParts.push(sanskritTokens.join(' '));
      const english = tokens.filter((token) => !sanskritTokens.includes(token)).join(' ').trim();
      if (english.length > 8) meaningParts.push(english);
    }
    if (verseParts.length >= 6) break;
  }
  if (verseParts.length < 2) return undefined;
  const verse = verseParts.join(' ');
  if (/\b(urge of speech|demands of the mind)\b/i.test(verse)) return undefined;
  return {
    verse,
    meaning: meaningParts.join(' ')
  };
};

export const extractBestList = (text: string, intent: ExactIntent, pageNumber?: number): ExtractedList | null => {
  const lineItems = extractFromLines(text);
  const collapsedItems = lineItems.length >= 3 ? [] : extractFromCollapsed(text);
  const groups = groupSequences(lineItems.length >= 2 ? lineItems : collapsedItems);
  if (!groups.length) {
    const compact = extractCompactList(text, intent);
    return compact ? { ...compact, pageNumber } : null;
  }

  const ranked = groups
    .filter((items) => !(intent.type === 'list' && intent.expectedCount && items[0]?.n !== 1))
    .map((items) => {
      const heading = nearbyHeading(text, items[0].english || items[0].sanskrit);
      return { items, heading, score: scoreGroup(items, intent, heading) };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 12) {
    const compact = extractCompactList(text, intent);
    return compact ? { ...compact, pageNumber } : null;
  }
  if (intent.type === 'list' && intent.expectedCount && best.items.length < intent.expectedCount - 1) {
    const compact = extractCompactList(text, intent);
    if (compact && compact.items.length >= (intent.expectedCount || 0)) {
      return { ...compact, pageNumber };
    }
  }

  const lastEnglish = best.items[best.items.length - 1].english;
  const sloka = extractSlokaFromText(text, lastEnglish);
  const after = text.split(lastEnglish)[1] || '';
  const details = after
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeSpace(part))
    .filter((part) => part.length > 40 && part.length < 280)
    .filter((part) => !/^\d{1,2}[a-z]?[.)]/i.test(part))
    .filter((part) => !/^(etān|etan|vāco|vaco|ānukūlya|viṣaheta|yo |sarvām)/i.test(part))
    .filter((part) => !looksLikeSanskrit(part.split(/\s+/)[0] || '', true) || part.split(/\s+/).length > 8)
    .slice(0, 2);

  const items = best.items.map((item) => ({
    ...item,
    sanskrit: item.sanskrit.replace(/\b(etān|etan|yo|sarvām|sa|śiṣyāt|sadbhir|ṣaḍbhir)\b.*$/i, '').trim(),
    english: item.english.replace(/\b(etān|A sober|When one is victimized)\b[\s\S]*$/i, '').trim()
  }));

  return {
    heading: best.heading || titleCaseTopic(intent.topic),
    items,
    sloka,
    note: details.join(' '),
    pageNumber
  };
};

export const formatListAnswer = (list: ExtractedList, intent: ExactIntent) => {
  const title = list.heading || titleCaseTopic(intent.topic);
  const lines = list.items.map((item) => {
    if (item.sanskrit) return `${item.n}. **${item.sanskrit}** — ${item.english}`;
    return `${item.n}. ${item.english}`;
  });

  const parts = [
    `## ${title}`,
    '',
    intent.type === 'list' && intent.expectedCount
      ? `The document names these **${list.items.length}** items exactly:`
      : 'The document lists the following items:',
    '',
    ...lines
  ];

  if (list.sloka?.verse || list.sloka?.meaning) {
    parts.push('', '### The sloka / verse');
    if (list.sloka.verse) parts.push('', `> ${list.sloka.verse}`);
    if (list.sloka.meaning) parts.push('', list.sloka.meaning);
  }

  if (list.note && !/^Listed from/.test(list.note)) {
    parts.push('', '### From the text', '', list.note);
  } else if (list.note) {
    parts.push('', list.note);
  }

  if (list.pageNumber) {
    parts.push('', `Source: page ${list.pageNumber}.`);
  }

  return parts.join('\n');
};

export const formatSlokaAnswer = (list: ExtractedList, intent: ExactIntent) => {
  const parts = [`## ${titleCaseTopic(intent.topic)}`, ''];
  if (list.sloka?.verse) {
    parts.push('### Sloka', '', `> ${list.sloka.verse}`, '');
  }
  if (list.sloka?.meaning) {
    parts.push('### Meaning', '', list.sloka.meaning, '');
  }
  if (list.items.length) {
    parts.push('### Exact points from the text', '');
    parts.push(
      ...list.items.map((item) =>
        item.sanskrit ? `${item.n}. **${item.sanskrit}** — ${item.english}` : `${item.n}. ${item.english}`
      )
    );
  }
  if (list.pageNumber) parts.push('', `Source: page ${list.pageNumber}.`);
  return parts.join('\n');
};
