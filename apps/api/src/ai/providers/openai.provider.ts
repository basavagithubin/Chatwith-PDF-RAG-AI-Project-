import OpenAI from 'openai';
import '../../config/env.js';

const getClient = () => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
}

export interface LLMProvider {
  generateAnswer(messages: Array<{ role: string; content: string }>): Promise<string>;
  streamAnswer(messages: Array<{ role: string; content: string }>): AsyncIterable<string>;
}

export class OpenAIProvider implements EmbeddingProvider, LLMProvider {
  async generateEmbedding(text: string) {
    const input = text.length > 8000 ? text.slice(0, 8000) : text;
    const response = await getClient().embeddings.create({
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      input
    });
    return response.data[0].embedding;
  }

  async generateAnswer(messages: Array<{ role: string; content: string }>) {
    const completion = await getClient().chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      messages: messages as any,
      max_tokens: Number(process.env.OPENAI_MAX_TOKENS || 1600),
      temperature: 0.2
    });
    return completion.choices[0]?.message?.content ?? '';
  }

  async *streamAnswer(messages: Array<{ role: string; content: string }>): AsyncIterable<string> {
    const stream = await getClient().chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      messages: messages as any,
      max_tokens: Number(process.env.OPENAI_MAX_TOKENS || 1600),
      temperature: 0.2,
      stream: true
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
  }
}
