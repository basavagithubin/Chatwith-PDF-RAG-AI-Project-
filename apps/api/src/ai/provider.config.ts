import '../config/env.js';

/** True when a real OpenAI key is configured (not empty / placeholder). */
export const hasOpenAIKey = () => {
  const key = process.env.OPENAI_API_KEY?.trim() ?? '';
  return key.length > 20 && !/^your[_-]?key$/i.test(key);
};

/** Prefer OpenAI when explicitly set or when a key exists and provider is unset/auto. */
export const resolveLLMProviderName = () => {
  const configured = (process.env.LLM_PROVIDER ?? 'auto').toLowerCase();
  if (configured === 'mock') return 'mock';
  if (configured === 'openai' || configured === 'auto') {
    return hasOpenAIKey() ? 'openai' : 'mock';
  }
  return hasOpenAIKey() ? 'openai' : 'mock';
};

export const resolveEmbeddingProviderName = () => {
  const configured = (process.env.EMBEDDING_PROVIDER ?? 'auto').toLowerCase();
  if (configured === 'mock') return 'mock';
  if (configured === 'openai' || configured === 'auto') {
    return hasOpenAIKey() ? 'openai' : 'mock';
  }
  return hasOpenAIKey() ? 'openai' : 'mock';
};

export const isRealLLMEnabled = () => resolveLLMProviderName() === 'openai';
