import { OpenAIProvider } from './providers/openai.provider.js';
import { MockLLMProvider } from './providers/mock.provider.js';
import { resolveLLMProviderName } from './provider.config.js';
import '../config/env.js';

export interface LLMProvider {
  generateAnswer(messages: Array<{ role: string; content: string }>): Promise<string>;
  streamAnswer(messages: Array<{ role: string; content: string }>): AsyncIterable<string>;
}

export const createLLMProvider = (): LLMProvider => {
  const provider = resolveLLMProviderName();
  if (provider === 'openai') {
    return new OpenAIProvider();
  }
  return new MockLLMProvider();
};
