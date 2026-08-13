export type ChatTurn = { role: 'user' | 'assistant'; content: string };

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  last: -1
};

const FOLLOW_UP =
  /^(?:and\b|also\b|what about\b|how about\b|explain\b|more\b|why\b|where\b|which\b|compare\b|that\b|this\b|it\b|them\b|the\s+(?:first|second|third|fourth|fifth|sixth|last|\d)|where is that|tell me more|go deeper|same topic)/i;

const PRONOUN =
  /\b(it|that|this|those|them|the (?:first|second|third|fourth|fifth|sixth|last|\d+(?:st|nd|rd|th)?)(?:\s+(?:one|item|urge|point|concept))?)\b/i;

const stripMarkdown = (value: string) =>
  value
    .replace(/[#*_`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const lastOfRole = (history: ChatTurn[], role: ChatTurn['role']) => {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === role && history[index].content.trim()) return history[index];
  }
  return null;
};

const extractOrdinal = (query: string): number | null => {
  const word = query.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\b/i)?.[1];
  if (word) return ORDINAL_WORDS[word.toLowerCase()] ?? null;
  const nth = query.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/i)?.[1];
  if (nth) return Number(nth);
  return null;
};

const extractListItems = (answer: string): string[] => {
  const items: string[] = [];
  const numbered = answer.matchAll(/^\s*(\d{1,2})[.)]\s+(.+)$/gm);
  for (const match of numbered) {
    const index = Number(match[1]);
    items[index - 1] = stripMarkdown(match[2]).slice(0, 180);
  }
  if (items.filter(Boolean).length >= 2) return items;
  const bullets = [...answer.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((match) => stripMarkdown(match[1]).slice(0, 180));
  return bullets.length >= 2 ? bullets : [];
};

const isFollowUp = (query: string, history: ChatTurn[]) => {
  if (!history.length) return false;
  const text = query.trim();
  if (text.length < 4) return true;
  if (FOLLOW_UP.test(text) || PRONOUN.test(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= 3 && /^(yes|no|why|more|and|also|ok|okay)\b/i.test(text);
};

export const rewriteQueryWithHistory = (
  query: string,
  history: ChatTurn[]
): { query: string; rewritten: boolean; resolvedFrom?: string } => {
  const recent = history.filter((turn) => turn.content?.trim()).slice(-8);
  if (!isFollowUp(query, recent)) {
    return { query: query.trim(), rewritten: false };
  }

  const lastUser = lastOfRole(recent, 'user');
  const lastAssistant = lastOfRole(recent, 'assistant');
  const priorQuestion = stripMarkdown(lastUser?.content || '').slice(0, 200);
  const priorAnswer = stripMarkdown(lastAssistant?.content || '').slice(0, 400);
  const topicHint = priorQuestion
    .replace(/\b(name|list|enumerate|mention|what are|which are|tell me about|give me)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ordinal = extractOrdinal(query);
  const items = lastAssistant ? extractListItems(lastAssistant.content) : [];

  let resolved = query.trim();
  if (ordinal != null && items.length) {
    const index = ordinal < 0 ? items.length : ordinal;
    const item = items[index - 1];
    if (item) {
      resolved = `Explain only item ${index}: ${item}. Topic: ${topicHint || 'the previous list'}. Do not enumerate the full list.`;
    }
  } else if (/where|page|in the book|cited/i.test(query) && (topicHint || priorQuestion)) {
    resolved = `Cite the page numbers for ${topicHint || priorQuestion}. Reply with page citations only.`;
  } else if (/compare/i.test(query) && (topicHint || priorQuestion)) {
    resolved = `${query.trim()} compared with ${topicHint || priorQuestion}`;
  } else if (topicHint || priorQuestion) {
    resolved = `${query.trim()} — continue the topic "${topicHint || priorQuestion}"${priorAnswer ? ` (excerpt: ${priorAnswer.slice(0, 180)})` : ''}`;
  }

  if (resolved === query.trim()) return { query: resolved, rewritten: false };
  return { query: resolved, rewritten: true, resolvedFrom: priorQuestion || undefined };
};
