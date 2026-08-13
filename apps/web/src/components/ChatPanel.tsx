import { FormEvent, useEffect, useRef, useState } from 'react';
import { BotAvatar, CheckIcon, CopyIcon, PencilIcon, RefreshIcon, SendIcon, TrashIcon } from './Icons';
import MessageContent from './MessageContent';
import GraphCard from './GraphCard';
import SpellingNotice, { readSpelling } from './SpellingNotice';
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
  onEdit?: (messageId: string, query: string) => void;
  onDelete?: (messageId: string) => void;
  onRegenerate?: (assistantId: string) => void;
  onAccept?: (assistantId: string) => void;
  onClear?: () => void;
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
  onEdit,
  onDelete,
  onRegenerate,
  onAccept,
  onClear,
  onOpenPage,
  className = ''
}: ChatPanelProps) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const suggestions = defaultSuggestions();
  const typingVisible = showTyping ?? isLoading;
  const canMutate = !isLoading && documentReady;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingVisible, loadingHint]);

  const submit = (text: string) => {
    if (!text.trim() || isLoading || !documentReady) return;
    onSend(text.trim());
    setQuery('');
    setEditingId(null);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(query);
  };

  const startEdit = (message: ChatMessage) => {
    if (!canMutate) return;
    setEditingId(message.id);
    setDraft(message.content);
  };

  const saveEdit = (messageId: string) => {
    const text = draft.trim();
    if (!text || !onEdit) return;
    onEdit(messageId, text);
    setEditingId(null);
    setDraft('');
  };

  const actionBtn =
    'rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <section
      className={`flex w-full flex-col border-l border-ink-200/80 bg-surface md:w-[440px] md:shrink-0 xl:w-[480px] ${className}`}
    >
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <div>
          <p className="font-display text-sm font-semibold text-ink-950">Chat</p>
          <p className="text-xs text-ink-400">{documentName?.replace(/\.pdf$/i, '') ?? 'Document Q&A'}</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={isLoading}
            className="rounded-lg px-2 py-1 text-xs font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:opacity-40"
          >
            Clear chat
          </button>
        )}
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
                  <div className="group inline-block max-w-full text-left">
                    {editingId === message.id ? (
                      <div className="w-[min(100%,22rem)] rounded-2xl rounded-tr-md border border-brand-300 bg-surface p-2 shadow-card">
                        <textarea
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          rows={3}
                          className="w-full resize-none bg-transparent text-sm text-ink-950 focus:outline-none"
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              saveEdit(message.id);
                            }
                            if (event.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <div className="mt-1 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-lg px-2 py-1 text-xs text-ink-500 hover:bg-ink-100"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEdit(message.id)}
                            disabled={!draft.trim()}
                            className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
                          >
                            Save & ask
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="inline-block max-w-full rounded-2xl rounded-tr-md bg-brand-700 px-4 py-3 text-sm leading-relaxed text-white">
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                        <div className="mt-1 flex justify-end gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                          <button
                            type="button"
                            className={actionBtn}
                            aria-label="Copy question"
                            disabled={!canMutate && isLoading}
                            onClick={() => void navigator.clipboard.writeText(message.content)}
                          >
                            <CopyIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={actionBtn}
                            aria-label="Edit question"
                            disabled={!canMutate}
                            onClick={() => startEdit(message)}
                          >
                            <PencilIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={actionBtn}
                            aria-label="Delete question"
                            disabled={!canMutate}
                            onClick={() => onDelete?.(message.id)}
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="group w-full rounded-2xl rounded-tl-md border border-ink-100 bg-surface px-4 py-3.5 shadow-card">
                    {(() => {
                      const spelling = readSpelling(message.meta);
                      return spelling ? <SpellingNotice spelling={spelling} /> : null;
                    })()}
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
                            className="rounded-lg border border-brand-200 bg-surface px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50"
                          >
                            Explain 2nd concept
                          </button>
                          <button
                            type="button"
                            onClick={() => submit('Create a mind map for Chapter 1')}
                            className="rounded-lg border border-brand-200 bg-surface px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50"
                          >
                            Mind map
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => submit('Create a graph for Chapter 1')}
                          className="rounded-lg border border-brand-200 bg-surface px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50"
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
                        className={actionBtn}
                        aria-label="Copy answer"
                        onClick={() => void navigator.clipboard.writeText(message.content)}
                      >
                        <CopyIcon />
                      </button>
                      <button
                        type="button"
                        className={actionBtn}
                        aria-label="Keep this answer for training"
                        disabled={!canMutate}
                        onClick={() => onAccept?.(message.id)}
                      >
                        <CheckIcon />
                      </button>
                      <button
                        type="button"
                        className={actionBtn}
                        aria-label="Regenerate answer"
                        disabled={!canMutate}
                        onClick={() => onRegenerate?.(message.id)}
                      >
                        <RefreshIcon />
                      </button>
                      <button
                        type="button"
                        className={actionBtn}
                        aria-label="Delete answer"
                        disabled={!canMutate}
                        onClick={() => onDelete?.(message.id)}
                      >
                        <TrashIcon />
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
              className="block w-full rounded-xl border border-ink-200 bg-surface px-4 py-3 text-left text-sm text-ink-700 transition hover:border-brand-300 hover:bg-brand-50/50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="panel-danger mx-4 mb-2 rounded-xl px-3 py-2 text-sm">
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
