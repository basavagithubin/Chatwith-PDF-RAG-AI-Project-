import crypto from 'crypto';

const EMBEDDING_SIZE = 1536;

const createDeterministicVector = (text: string) => {
  const vector = new Array<number>(EMBEDDING_SIZE).fill(0);
  for (let index = 0; index < EMBEDDING_SIZE; index += 1) {
    const hash = crypto.createHash('sha256').update(`${text}:${index}`).digest();
    vector[index] = (hash[index % hash.length] / 255) * 2 - 1;
  }
  return vector;
};

const cleanText = (value: string) =>
  value
    .replace(/\[Source[^\]]+\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractQuestion = (context: string) => {
  const match = context.match(/Question:\s*([^\n]+)/i);
  return match?.[1]?.trim() ?? 'your question';
};

const extractChunks = (context: string) => {
  const withoutQuestion = context
    .replace(/Question:[\s\S]*$/, '')
    .replace(/^Context:\s*/i, '')
    .trim();
  return withoutQuestion
    .split(/\n---\n/)
    .map((chunk) => cleanText(chunk))
    .filter(Boolean);
};

const TITLE_WORD = String.raw`(?:[A-Z][A-Za-z0-9'’:,\-]+|(?:of|the|and|a|an|for|to|in|on|with|from|by|or))`;

const normalizeTitle = (value: string) =>
  cleanText(value)
    .replace(/\s+[IVXLC]{1,6}\.\s+[A-Z].*$/i, '')
    .replace(/\s+[IVXLC]{1,6}$/i, '')
    .replace(/\s+\d{1,3}$/g, '')
    .replace(/\s+(?:of|the|and|a|an|for|to|in|on|with|from|by|or)$/i, '')
    .replace(/[.:,\-]+$/, '')
    .trim();

const extractTitles = (chunks: string[]) => {
  const titles = new Map<string, string>();
  const patterns = [
    new RegExp(String.raw`\b([IVXLC]+)\.\s+((?:[A-Z][A-Za-z0-9'’:,\-]+(?:\s+${TITLE_WORD}){1,14}))`, 'g'),
    new RegExp(String.raw`\b(\d+(?:\.\d+)?)\s+((?:[A-Z][A-Za-z0-9'’:,\-]+(?:\s+${TITLE_WORD}){1,14}))`, 'g'),
    new RegExp(String.raw`\b(Chapter)\s+(\d+[:.\-]?\s*(?:[A-Z][A-Za-z0-9'’:,\-]+(?:\s+${TITLE_WORD}){0,14}))`, 'gi')
  ];

  for (const chunk of chunks) {
    for (const pattern of patterns) {
      for (const match of chunk.matchAll(pattern)) {
        const label = match[1].trim();
        const title = normalizeTitle(match[2]);
        if (title.length < 8 || title.length > 90) continue;
        const key = title.toLowerCase();
        if (titles.has(key)) continue;
        if (/^chapter$/i.test(label)) {
          titles.set(key, `Chapter ${normalizeTitle(match[2])}`);
        } else {
          titles.set(key, `${label.toUpperCase()}. ${title}`);
        }
      }
    }
  }

  return Array.from(titles.values()).slice(0, 16);
};

const topicFromQuestion = (question: string) => {
  const cleaned = question
    .replace(/\b(give me|tell me|please|can you|could you|what is|what's|describe|description|explain|about|of|the|a|an|detail|details|everything|point|points)\b/gi, ' ')
    .replace(/[^\w\s'’-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'this topic';
  return cleaned
    .split(/\s+/)
    .slice(0, 8)
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
};

const modernize = (text: string) => {
  let value = cleanText(text)
    .replace(/^Translation\s+/i, '')
    .replace(/^Commentary\s+/i, '')
    .replace(/^The Blessed Lord said:\s*/i, '')
    .replace(/^Suta said:\s*/i, '')
    .replace(/^Garu\s*ḍ?a said:\s*/i, '')
    .replace(/^Garuda said:\s*/i, '')
    .replace(/^Lord said:\s*/i, '')
    .replace(/^\[\s*Source[^\]]+\]\s*/i, '')
    .replace(/\bO\s+(Shining One|Lord of Birds|Tārkṣya|Tarksya|Bird|King|Twice[- ]born|Keśava)[,!]?\s*/gi, '')
    .replace(/\b(Thee|Thou)\b/gi, 'you')
    .replace(/\b(Thy|Thine)\b/gi, 'your')
    .replace(/\bunto\b/gi, 'to')
    .replace(/\bhence\b/gi, 'so')
    .replace(/\btherefore\b/gi, 'so')
    .replace(/\bshall\b/gi, 'will')
    .replace(/\bmust\b/gi, 'should')
    .replace(/\bthe departed\b/gi, 'the deceased')
    .replace(/\bWay of Yama\b/gi, 'path to Yama’s realm')
    .replace(/\bworld of Yama\b/gi, 'realm of Yama')
    .replace(/\babode of Yama\b/gi, 'realm of Yama')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/\b\d+\s*I\.e\.?.*$/i, '')
    .replace(/\s+[IVXLC]{1,6}\.?$/g, '')
    .replace(/\s+\d{1,3}\.\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\.'+/g, '.')
    .replace(/'\./g, '.')
    .replace(/\s+\./g, '.')
    .replace(/--/g, '—')
    .trim();

  if (value.length > 210) {
    const cut = value.slice(0, 210);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
    value = lastStop > 70 ? cut.slice(0, lastStop + 1) : `${cut.trim()}…`;
  }

  if (value && !/[.!?…]$/.test(value)) value = `${value}.`;
  if (value) value = value.charAt(0).toUpperCase() + value.slice(1);
  return value;
};

const isNoiseFact = (text: string) => {
  const value = text.trim();
  if (value.length < 45 || value.length > 260) return true;
  if (/^An Account Of\b/i.test(value)) return true;
  if (/^The Collecting Of\b/i.test(value)) return true;
  if (/^[IVXLC]+\.\s+/i.test(value)) return true;
  if (/Contents\s+Introduction/i.test(value)) return true;
  if (/synonyms|permanent educative effect/i.test(value)) return true;
  if (/^Babhruvahana/i.test(value)) return true;
  return false;
};

const expandQuestionTerms = (question: string) => {
  const text = question.toLowerCase();
  const extras: string[] = [];
  if (/yama/.test(text)) extras.push('yama', 'hell', 'torment', 'way of yama', 'kumbhipaka', 'abode of yama');
  if (/loka/.test(text)) extras.push('hell', 'realm', 'world of yama', 'abode');
  if (/sapi|impurit|pollution|pure/.test(text)) extras.push('sapiṇḍa', 'impurity', 'pure', 'relatives');
  if (/rite|ceremony|funeral/.test(text)) extras.push('rite', 'ceremony', 'offerings', 'deceased');
  return extras;
};

const scoreChunk = (chunk: string, question: string) => {
  const lowerChunk = chunk.toLowerCase();
  const words = [
    ...question
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 3 &&
          !['give', 'me', 'detail', 'details', 'about', 'the', 'and', 'for', 'with', 'from', 'this', 'that', 'everything', 'point', 'points', 'describe', 'description', 'explain', 'what'].includes(word)
      ),
    ...expandQuestionTerms(question)
  ];

  let score = 0;
  for (const word of words) {
    if (lowerChunk.includes(word)) score += 3;
  }
  if (/yama|hell|way of yama|torment|kumbh/i.test(lowerChunk) && /yama|hell|loka|torment/i.test(question)) score += 10;
  if (/contents\s+introduction|an account of the way of yama\s+iii/i.test(lowerChunk)) score -= 6;
  return score;
};

const extractFacts = (chunks: string[], question: string) => {
  const ranked = [...chunks]
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, question) }))
    .sort((a, b) => b.score - a.score);

  const relevant = (ranked[0]?.score ?? 0) > 0
    ? ranked.filter((item) => item.score >= Math.max(1, (ranked[0]?.score ?? 0) - 12))
    : ranked.slice(0, 4);

  const facts: string[] = [];
  const push = (raw: string) => {
    const cleaned = modernize(raw);
    if (isNoiseFact(cleaned)) return;
    if (facts.some((existing) => existing.toLowerCase().slice(0, 36) === cleaned.toLowerCase().slice(0, 36))) return;
    facts.push(cleaned);
  };

  for (const item of relevant) {
    const sentences = item.chunk
      .split(/(?<=[.!?])\s+/)
      .map(cleanText)
      .filter((part) => part.length > 45 && part.length < 380);

    const ordered = sentences
      .map((sentence) => ({ sentence, score: scoreChunk(sentence, question) }))
      .sort((a, b) => b.score - a.score);

    for (const entry of ordered) {
      push(entry.sentence);
      if (facts.length >= 7) break;
    }
    if (facts.length >= 7) break;
  }

  // Fallback: take readable sentences even if keyword scoring is weak.
  if (!facts.length) {
    for (const chunk of chunks.slice(0, 5)) {
      for (const sentence of chunk.split(/(?<=[.!?])\s+/).slice(0, 6)) {
        push(sentence);
        if (facts.length >= 5) break;
      }
      if (facts.length >= 5) break;
    }
  }

  return facts.slice(0, 6);
};

const detectIntent = (question: string) => {
  const text = question.toLowerCase();
  if (/\b(summarize|summary|brief|short)\b/.test(text)) return 'summary';
  if (/\b(describe|description|what is|what's|who is|meaning of)\b/.test(text)) return 'describe';
  if (/\b(how|why|process|steps|rite|ceremony)\b/.test(text)) return 'explain';
  return 'explain';
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'is', 'are',
  'was', 'were', 'be', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'how', 'why',
  'does', 'do', 'did', 'say', 'says', 'about', 'give', 'tell', 'please', 'can', 'you', 'me',
  'pdf', 'document', 'text', 'chapter', 'page', 'pages'
]);

/** True when the question's distinctive terms barely appear in retrieved context. */
const isInsufficientEvidence = (question: string, chunks: string[], facts: string[]) => {
  const context = chunks.join(' ').toLowerCase();
  const tokens = question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3 && !STOPWORDS.has(token));

  if (!tokens.length) return !facts.length;

  const hits = tokens.filter((token) => context.includes(token)).length;
  const coverage = hits / tokens.length;

  // Modern / scientific off-topic probes usually share almost no lexical overlap.
  if (coverage < 0.35) return true;
  if (!facts.length && coverage < 0.55) return true;
  return false;
};

const insufficientAnswer = (question: string) => {
  const topic = topicFromQuestion(question);
  return [
    `## ${topic}`,
    '',
    'Not enough evidence in the retrieved document context to answer this confidently.',
    '',
    'The uploaded PDF does not appear to discuss this topic in the passages I found.',
    'Try asking about a chapter, section, or concept that is actually present in the document.'
  ].join('\n');
};

const composeAnswer = (question: string, facts: string[]) => {
  const topic = topicFromQuestion(question);
  const intent = detectIntent(question);
  const topicKey = topic.toLowerCase().split(/\s+/)[0] || '';

  if (!facts.length) {
    return insufficientAnswer(question);
  }

  const rankedFacts = [...facts].sort((a, b) => {
    const score = (text: string) => {
      let value = 0;
      if (topicKey && text.toLowerCase().includes(topicKey)) value += 3;
      return value;
    };
    return score(b) - score(a);
  });

  const overview = rankedFacts[0];
  const supporting = rankedFacts.slice(1, 5);
  const closing = rankedFacts.find((fact) => fact !== overview) || overview;

  if (intent === 'summary') {
    return [
      `## ${topic}`,
      '',
      [overview, ...supporting.slice(0, 2)].join(' '),
      '',
      '### Takeaway',
      closing
    ].join('\n');
  }

  if (intent === 'describe') {
    const simple =
      closing !== overview
        ? closing
        : `In short, the text presents **${topic}** as an important teaching drawn from the cited passages.`;

    return [
      `## ${topic}`,
      '',
      '### Overview',
      `According to the document, **${topic}** is portrayed through these teachings: ${overview}`,
      '',
      '### What the document describes',
      supporting.length
        ? supporting.map((fact) => `- ${fact}`).join('\n')
        : `- ${closing}`,
      '',
      '### In simple terms',
      simple
    ].join('\n');
  }

  return [
    `## ${topic}`,
    '',
    '### Overview',
    overview,
    '',
    '### Key ideas from the document',
    ...supporting.map((fact) => `- ${fact}`),
    '',
    '### Bottom line',
    closing !== overview
      ? closing
      : `The document presents **${topic}** as an important teaching and explains it through the passages cited below.`
  ].join('\n');
};

export class MockEmbeddingProvider {
  async generateEmbedding(text: string) {
    return createDeterministicVector(text);
  }
}

export class MockLLMProvider {
  async generateAnswer(messages: Array<{ role: string; content: string }>) {
    const userMessage = [...messages].reverse().find((message) => message.role === 'user');
    const payload = userMessage?.content ?? '';
    const question = extractQuestion(payload);
    const chunks = extractChunks(payload);

    // Chapter-analysis rewrite prompts pass structured drafts, not RAG Context blocks.
    if (!payload.includes('Context:') && payload.length > 80) {
      return composeStructuredRewrite(payload);
    }

    if (!chunks.length) {
      return [
        '## Answer',
        '',
        'I could not find enough information in the uploaded document to answer that question confidently.',
        '',
        'Try asking about a specific chapter, section, or topic mentioned in the PDF.'
      ].join('\n');
    }

    const lowerQuestion = question.toLowerCase();
    const wantsChapterList =
      (/chapter|section|contents|index|heading|title|topic/.test(lowerQuestion) ||
        /all chapter|chapter name|list.*chapter|give.*chapter/.test(lowerQuestion)) &&
      !/detail|explain|about|account|point|describe|description/.test(lowerQuestion) &&
      !/\b(graph|diagram|visualize|visualise|concept\s*map|mind\s*map|knowledge\s*graph|timeline|cause\s*and\s*effect)\b/.test(lowerQuestion);

    if (wantsChapterList) {
      const titles = extractTitles(chunks);
      if (titles.length) {
        return [
          '## Table of contents',
          '',
          'Here are the main chapters identified in this document:',
          '',
          ...titles.map((title) => `- **${title}**`),
          '',
          'Ask about any chapter for a clear explanation — for example: **Explain Chapter I**.',
          'You can also request a concept graph: **Create a graph for Chapter 1**.'
        ].join('\n');
      }
    }

    const facts = extractFacts(chunks, question);
    if (isInsufficientEvidence(question, chunks, facts)) {
      return insufficientAnswer(question);
    }
    return composeAnswer(question, facts);
  }

  async *streamAnswer(messages: Array<{ role: string; content: string }>): AsyncIterable<string> {
    const full = await this.generateAnswer(messages);
    yield* chunkTextForStream(full);
  }
}

/** Yield small word/punctuation chunks so mock mode still feels streamed. */
export async function* chunkTextForStream(text: string, delayMs = 12): AsyncIterable<string> {
  const parts = text.match(/\S+\s*|\s+/g) || [text];
  for (const part of parts) {
    yield part;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const composeStructuredRewrite = (payload: string) => {
  const chapter = payload.match(/Chapter:\s*([^\n]+)/i)?.[1]?.trim() || 'Chapter';
  const overview = modernize(payload.match(/Overview draft:\s*([^\n]+)/i)?.[1] || '');
  const theme = modernize(payload.match(/Main theme:\s*([^\n]+)/i)?.[1] || '');
  const points = (payload.match(/Important points:\s*([^\n]+)/i)?.[1] || '')
    .split('|')
    .map((part) => modernize(part))
    .filter((part) => part.length > 30)
    .slice(0, 6);

  return [
    `# ${chapter}`,
    '',
    '## Overview',
    overview || theme || 'This chapter presents the main teachings found in the selected pages.',
    '',
    '## Main idea',
    theme || overview || 'The chapter focuses on practical and moral guidance.',
    '',
    '## Key ideas',
    ...(points.length ? points.map((point) => `- ${point}`) : ['- The chapter develops its teaching through successive instructions and examples.']),
    '',
    '## Simple explanation',
    'In clear terms, this chapter explains what the reader should understand, why it matters, and what conclusion to carry forward.',
    '',
    '## Bottom line',
    points[points.length - 1] || theme || 'The chapter ends by reinforcing its main teaching.'
  ].join('\n');
};
