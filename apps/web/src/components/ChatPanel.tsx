import { FormEvent, useEffect, useRef, useState } from 'react';
import { BotAvatar, CopyIcon, SendIcon } from './Icons';
import MessageContent from './MessageContent';
import GraphCard from './GraphCard';
import type { ChapterGraphData } from '../types/graph';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'TEXT_RESPONSE' | 'GRAPH_RESPONSE';
  graph?: ChapterGraphData | null;
  sources?: Array<{ pageNumber?: number; sourceText?: string }>;
  meta?: Record<string, unknown>;
  streaming?: boolean;
};

type ChatPanelProps = {
  documentReady: boolean;
  documentName?: string;
  messages: ChatMessage[];
  isLoading: boolean;
  showTyping?: boolean;
  loadingHint?: string;
  error?: string;
  onSend: (query: string) => void;
  onOpenPage?: (page: number) => void;
  className?: string;
};

const defaultSuggestions = () => [
  'Summarize this document',
  'Create a graph for Chapter 1',
  'What are the main themes?'
];

export default function ChatPanel({
  documentReady,
  documentName,
  messages,
  isLoading,
  showTyping,
  loadingHint,
  error,
  onSend,
  onOpenPage,
  className = ''
}: ChatPanelProps) {
  const [query, setQuery] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const suggestions = defaultSuggestions();
  const typingVisible = showTyping ?? isLoading;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingVisible, loadingHint]);

  const submit = (text: string) => {
    if (!text.trim() || isLoading || !documentReady) return;
    onSend(text.trim());
    setQuery('');
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(query);
  };

  return (
    <section
      className={`flex w-full flex-col border-l border-ink-200/80 bg-white md:w-[440px] md:shrink-0 xl:w-[480px] ${className}`}
    >
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <div>
          <p className="font-display text-sm font-semibold text-ink-950">Chat</p>
          <p className="text-xs text-ink-400">{documentName?.replace(/\.pdf$/i, '') ?? 'Document Q&A'}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-6">
        {!messages.length && !isLoading && (
          <div className="flex h-full flex-col justify-center">
            <div className="animate-fade-up flex gap-3">
              <BotAvatar />
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-semibold text-ink-950">Ready when you are</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">
                  Ask about any chapter, request a concept graph, or jump to cited pages in{' '}
                  <span className="font-medium text-ink-900">{documentName?.replace(/\.pdf$/i, '') ?? 'your PDF'}</span>.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {message.role === 'assistant' && <BotAvatar />}
              <div className={`min-w-0 flex-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                {message.role === 'user' ? (
                  <div className="inline-block max-w-full rounded-2xl rounded-tr-md bg-ink-950 px-4 py-3 text-sm leading-relaxed text-white">
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                ) : (
                  <div className="w-full rounded-2xl rounded-tl-md border border-ink-100 bg-white px-4 py-3.5 shadow-card">
                    <MessageContent
                      content={message.content}
                      sources={message.sources}
                      onOpenPage={onOpenPage}
                      streaming={message.streaming}
                      graphSlot={
                        message.type === 'GRAPH_RESPONSE' && message.graph ? (
                          <GraphCard graph={message.graph} onOpenPage={onOpenPage} />
                        ) : null
                      }
                    />
                    {!message.streaming && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.type === 'GRAPH_RESPONSE' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => submit('Explain the second concept')}
                            className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50"
                          >
                            Explain 2nd concept
                          </button>
                          <button
                            type="button"
                            onClick={() => submit('Create a mind map for Chapter 1')}
                            className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50"
                          >
                            Mind map
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => submit('Create a graph for Chapter 1')}
                          className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50"
                        >
                          Concept graph
                        </button>
                      )}
                    </div>
                    )}
                    {!message.streaming && (
                    <div className="mt-2 flex items-center gap-1 text-ink-300">
                      <button
                        type="button"
                        className="rounded-lg p-1.5 hover:bg-white hover:text-ink-600"
                        aria-label="Copy"
                        onClick={() => void navigator.clipboard.writeText(message.content)}
                      >
                        <CopyIcon />
                      </button>
                    </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {typingVisible && (
            <div className="flex gap-3">
              <BotAvatar />
              <div className="rounded-2xl border border-ink-100 bg-surface-muted px-4 py-3">
                {loadingHint ? (
                  <p className="animate-soft-pulse text-sm text-ink-600">{loadingHint}</p>
                ) : (
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-ink-300 [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-ink-300 [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-ink-300" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {!messages.length && documentReady && (
        <div className="space-y-2 px-4 pb-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submit(suggestion)}
              className="block w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-left text-sm text-ink-700 transition hover:border-brand-300 hover:bg-brand-50/50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="mx-4 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="border-t border-ink-100 p-4">
        <div className="rounded-2xl border border-ink-200 bg-surface-muted p-3 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={documentReady ? 'Ask about a chapter, concept, or graph…' : 'Waiting for document to finish processing…'}
            disabled={!documentReady || isLoading}
            rows={3}
            className="w-full resize-none bg-transparent text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit(query);
              }
            }}
          />
          <div className="mt-2 flex items-center justify-end">
            <button type="submit" disabled={!query.trim() || !documentReady || isLoading} className="btn-primary">
              <SendIcon className="h-4 w-4" />
              {isLoading ? 'Sending…' : 'Post'}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
