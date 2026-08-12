const GREETING_PATTERNS = [
  /^(hi|hello|hey|hola|namaste|namaskar|yo|hiya|howdy)[!.,\s]*$/i,
  /^(good\s*(morning|afternoon|evening|night))[!.,\s]*$/i,
  /^(hi|hello|hey)\s+(there|friend|all)[!.,\s]*$/i
];

const THANKS_PATTERNS = [
  /^(thanks|thank\s*you|thx|ty|much\s*appreciated)[!.,\s]*$/i
];

const BYE_PATTERNS = [
  /^(bye|goodbye|see\s*you|later|take\s*care)[!.,\s]*$/i
];

const HELP_PATTERNS = [
  /^(help|what\s+can\s+you\s+do|how\s+does\s+this\s+work)[!?.\s]*$/i
];

export type ConversationalReply = {
  answer: string;
  sources: [];
};

export const getConversationalReply = (query: string, documentName?: string): ConversationalReply | null => {
  const text = query.trim();
  if (!text) return null;

  const docLabel = documentName?.replace(/\.pdf$/i, '') || 'this PDF';

  if (GREETING_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      answer: [
        `Hi! I'm your PDF assistant for **${docLabel}**.`,
        '',
        'Ask me anything about the document — for example:',
        '- Summarize the main themes',
        '- List the chapter names',
        '- Explain a specific section'
      ].join('\n'),
      sources: []
    };
  }

  if (THANKS_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      answer: "You're welcome! If you have another question about the document, just ask.",
      sources: []
    };
  }

  if (BYE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      answer: 'Goodbye! Come back anytime if you want to explore the document further.',
      sources: []
    };
  }

  if (HELP_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      answer: [
        '## How I can help',
        '',
        `I answer questions using the content of **${docLabel}**.`,
        '',
        'Try asking things like:',
        '- What is this document about?',
        '- Give me all chapter names',
        '- Summarize page 3',
        '- Explain the key ideas in simple terms'
      ].join('\n'),
      sources: []
    };
  }

  return null;
};
