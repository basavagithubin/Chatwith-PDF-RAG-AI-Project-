import { OpenAIProvider } from './providers/openai.provider.js';
import { MockEmbeddingProvider } from './providers/mock.provider.js';
import { resolveEmbeddingProviderName } from './provider.config.js';
import '../config/env.js';

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
}

export const createEmbeddingProvider = (): EmbeddingProvider => {
  const provider = resolveEmbeddingProviderName();
  if (provider === 'openai') {
    return new OpenAIProvider();
  }
  return new MockEmbeddingProvider();
};
