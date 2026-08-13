import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ChatLayout from '../components/ChatLayout';
import ChatPanel, { ChatMessage } from '../components/ChatPanel';
import PdfViewerPanel from '../components/PdfViewerPanel';
import {
  getDocument,
  getDocumentFileUrl,
  searchDocumentStream,
  recordTrainingFeedback,
  ApiError
} from '../services/documents.service';
import { getReadingProgress, markDocumentOpened, setReadingProgress } from '../lib/library.prefs';
import type { ChapterGraphData } from '../types/graph';

const GRAPH_QUERY =
  /\b(graph|diagram|visualize|visualise|concept\s*map|mind\s*map|knowledge\s*graph|timeline|cause\s*(and|&)?\s*effect)\b/i;

const GRAPH_HINTS = [
  'Analyzing chapter…',
  'Reading chapter sections…',
  'Identifying key concepts…',
  'Building relationships…',
  'Creating graph…'
];

const chatStorageKey = (documentId: string) => `pdfchat-chat:${documentId}`;

type StoredChat = { conversationId?: string; messages: ChatMessage[] };

const normalizeMessages = (items: ChatMessage[]) =>
  items
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map((item) => ({ ...item, streaming: false }));

const readStoredChat = (documentId: string): StoredChat => {
  try {
    const raw = sessionStorage.getItem(chatStorageKey(documentId));
    if (!raw) return { messages: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { messages: normalizeMessages(parsed) };
    const messages = Array.isArray(parsed?.messages) ? normalizeMessages(parsed.messages) : [];
    const conversationId = typeof parsed?.conversationId === 'string' ? parsed.conversationId : undefined;
    return { conversationId, messages };
  } catch {
    return { messages: [] };
  }
};

export default function DocumentPage() {
  const { id } = useParams();
  const [document, setDocument] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasStreamContent, setHasStreamContent] = useState(false);
  const [loadingHint, setLoadingHint] = useState<string | undefined>();
  const [targetPage, setTargetPage] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<'pdf' | 'chat'>('chat');
  const abortRef = useRef<AbortController | null>(null);
  const skipPersistRef = useRef(false);
  const conversationIdRef = useRef<string | undefined>();

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    skipPersistRef.current = true;
    const stored = id ? readStoredChat(id) : { messages: [] as ChatMessage[] };
    conversationIdRef.current = stored.conversationId;
    setMessages(stored.messages);
    setError('');
    setDocument(null);
    setIsSearching(false);
    setHasStreamContent(false);
    setLoadingHint(undefined);
    setTargetPage(null);
    setMobileTab('chat');
  }, [id]);

  useEffect(() => {
    if (!id) return;
    markDocumentOpened(id);
    let timer: number | undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const details = await getDocument(id);
        if (cancelled) return;
        setDocument(details);
        if (details.page_count && !getReadingProgress(id)) {
          setReadingProgress(id, 1, Number(details.page_count));
        }
        if (!['READY', 'FAILED', 'CANCELLED'].includes(details.status)) {
          timer = window.setTimeout(load, 3000);
        }
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Unable to load document.');
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!id || !document?.page_count || !targetPage) return;
    setReadingProgress(id, targetPage, Number(document.page_count));
  }, [id, targetPage, document?.page_count]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    if (!id) return;
    const persistable = messages.filter((item) => !item.streaming);
    try {
      sessionStorage.setItem(
        chatStorageKey(id),
        JSON.stringify({ conversationId: conversationIdRef.current, messages: persistable })
      );
    } catch {
      /* ignore quota */
    }
  }, [messages, id]);

  const updateAssistant = (assistantId: string, patch: Partial<ChatMessage>) => {
    setMessages((current) =>
      current.map((message) => (message.id === assistantId ? { ...message, ...patch } : message))
    );
  };

  const handleSend = async (query: string, keepCount?: number) => {
    if (!id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: query };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      type: 'TEXT_RESPONSE',
      streaming: true
    };

    const historyBase =
      typeof keepCount === 'number' ? messages.slice(0, Math.max(0, keepCount)) : messages;
    const history = historyBase
      .filter((item) => !item.streaming && item.content.trim())
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content }));

    setMessages((current) => {
      const base = typeof keepCount === 'number' ? current.slice(0, Math.max(0, keepCount)) : current;
      return [...base, userMessage, assistantMessage];
    });
    setIsSearching(true);
    setHasStreamContent(false);
    setError('');

    const isGraph = GRAPH_QUERY.test(query);
    let hintTimer: number | undefined;
    if (isGraph) {
      let step = 0;
      setLoadingHint(GRAPH_HINTS[0]);
      hintTimer = window.setInterval(() => {
        step = Math.min(step + 1, GRAPH_HINTS.length - 1);
        setLoadingHint(GRAPH_HINTS[step]);
      }, 900);
    } else {
      setLoadingHint('Thinking…');
    }

    let assembled = '';

    try {
      await searchDocumentStream(
        id,
        query,
        {
          onStart: (event) => {
            const nextConversationId = event.meta && typeof event.meta.conversationId === 'string'
              ? event.meta.conversationId
              : undefined;
            if (nextConversationId) conversationIdRef.current = nextConversationId;
            updateAssistant(assistantId, {
              type: (event.responseType as ChatMessage['type']) || 'TEXT_RESPONSE',
              sources: event.sources,
              graph: (event.graph as ChapterGraphData | null) ?? null,
              meta: event.meta
            });
            if (event.responseType === 'GRAPH_RESPONSE') {
              setLoadingHint('Streaming graph answer…');
            } else {
              setLoadingHint(undefined);
            }
          },
          onToken: (text) => {
            assembled += text;
            setHasStreamContent(true);
            setLoadingHint(undefined);
            updateAssistant(assistantId, { content: assembled, streaming: true });
          },
          onDone: (answer) => {
            const finalAnswer = answer || assembled || 'No answer was returned.';
            updateAssistant(assistantId, {
              content: finalAnswer,
              streaming: false
            });
          },
          onError: (message) => {
            setError(message);
            updateAssistant(assistantId, {
              content: assembled || 'Unable to answer the question.',
              streaming: false
            });
          }
        },
        controller.signal,
        { conversationId: conversationIdRef.current, history }
      );

      if (!assembled) {
        // Ensure empty streams still clear the streaming caret.
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content || 'No answer was returned.',
                  streaming: false
                }
              : message
          )
        );
      }
    } catch (reason) {
      if ((reason as Error)?.name === 'AbortError') return;
      if (reason instanceof ApiError && reason.status === 429) {
        const wait = reason.retryAfter || 60;
        setError(`Rate limit reached. Please wait ${wait}s before asking again.`);
      } else {
        setError(reason instanceof Error ? reason.message : 'Unable to answer the question.');
      }
      updateAssistant(assistantId, {
        content: assembled || (reason instanceof ApiError && reason.status === 429
          ? `Too many requests. Try again in ${reason.retryAfter || 60}s.`
          : 'Unable to answer the question.'),
        streaming: false
      });
    } finally {
      if (hintTimer) window.clearInterval(hintTimer);
      setIsSearching(false);
      setHasStreamContent(false);
      setLoadingHint(undefined);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleEdit = (messageId: string, query: string) => {
    const index = messages.findIndex((item) => item.id === messageId);
    if (index < 0) return;
    const previous = messages[index]?.content;
    if (id) {
      void recordTrainingFeedback(id, {
        eventType: 'edit',
        question: query,
        previousAnswer: previous,
        conversationId: conversationIdRef.current
      }).catch(() => undefined);
    }
    void handleSend(query, index);
  };

  const handleDelete = (messageId: string) => {
    abortRef.current?.abort();
    setIsSearching(false);
    setHasStreamContent(false);
    setLoadingHint(undefined);
    setMessages((current) => {
      const index = current.findIndex((item) => item.id === messageId);
      if (index < 0) return current;
      const target = current[index];
      if (target.role === 'user') {
        const next = current[index + 1];
        const end = next?.role === 'assistant' ? index + 2 : index + 1;
        return [...current.slice(0, index), ...current.slice(end)];
      }
      const prev = current[index - 1];
      if (prev?.role === 'user') {
        return [...current.slice(0, index - 1), ...current.slice(index + 1)];
      }
      return [...current.slice(0, index), ...current.slice(index + 1)];
    });
  };

  const handleRegenerate = (assistantId: string) => {
    const index = messages.findIndex((item) => item.id === assistantId);
    const previous = index > 0 ? messages[index - 1] : null;
    const current = messages[index];
    if (!previous || previous.role !== 'user') return;
    if (id) {
      void recordTrainingFeedback(id, {
        eventType: 'regenerate',
        question: previous.content,
        previousAnswer: current?.content,
        conversationId: conversationIdRef.current
      }).catch(() => undefined);
    }
    void handleSend(previous.content, index - 1);
  };

  const handleAccept = (assistantId: string) => {
    const index = messages.findIndex((item) => item.id === assistantId);
    const current = messages[index];
    const previous = index > 0 ? messages[index - 1] : null;
    if (!current || !id) return;
    void recordTrainingFeedback(id, {
      eventType: 'accepted',
      question: previous?.role === 'user' ? previous.content : undefined,
      answer: current.content,
      conversationId: conversationIdRef.current,
      pages: (current.sources || [])
        .map((source) => Number(source.pageNumber))
        .filter((page) => Number.isFinite(page))
    }).catch(() => undefined);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError('');
    setIsSearching(false);
    setHasStreamContent(false);
    setLoadingHint(undefined);
    conversationIdRef.current = undefined;
    if (id) {
      try {
        sessionStorage.removeItem(chatStorageKey(id));
      } catch {
        /* ignore */
      }
    }
  };

  const openPage = (page: number) => {
    setTargetPage(page);
    setMobileTab('pdf');
  };

  return (
    <ChatLayout documentName={document?.name}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex border-b border-ink-200 bg-surface px-3 py-2 md:hidden">
          <div className="flex w-full rounded-xl bg-surface-muted p-1">
            <button
              type="button"
              onClick={() => setMobileTab('pdf')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mobileTab === 'pdf' ? 'bg-surface text-ink-950 shadow-card' : 'text-ink-500'
              }`}
            >
              PDF
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('chat')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mobileTab === 'chat' ? 'bg-surface text-ink-950 shadow-card' : 'text-ink-500'
              }`}
            >
              Chat
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {id && (
            <PdfViewerPanel
              fileUrl={getDocumentFileUrl(id)}
              documentName={document?.name}
              pageCount={document?.page_count}
              status={document?.status}
              targetPage={targetPage}
              className={mobileTab === 'pdf' ? 'flex' : 'hidden md:flex'}
            />
          )}
          <ChatPanel
            documentReady={document?.status === 'READY'}
            documentName={document?.name}
            messages={messages}
            isLoading={isSearching}
            showTyping={isSearching && !hasStreamContent}
            loadingHint={loadingHint}
            error={error}
            onSend={handleSend}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRegenerate={handleRegenerate}
            onAccept={handleAccept}
            onClear={handleClear}
            onOpenPage={openPage}
            className={mobileTab === 'chat' ? 'flex' : 'hidden md:flex'}
          />
        </div>
      </div>
    </ChatLayout>
  );
}
