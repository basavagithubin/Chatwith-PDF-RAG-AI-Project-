import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ChatLayout from '../components/ChatLayout';
import ChatPanel, { ChatMessage } from '../components/ChatPanel';
import PdfViewerPanel from '../components/PdfViewerPanel';
import { getDocument, getDocumentFileUrl, searchDocumentStream, ApiError } from '../services/documents.service';
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

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
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
    let timer: number | undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const details = await getDocument(id);
        if (cancelled) return;
        setDocument(details);
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

  const updateAssistant = (assistantId: string, patch: Partial<ChatMessage>) => {
    setMessages((current) =>
      current.map((message) => (message.id === assistantId ? { ...message, ...patch } : message))
    );
  };

  const handleSend = async (query: string) => {
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

    setMessages((current) => [...current, userMessage, assistantMessage]);
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
        controller.signal
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

  const openPage = (page: number) => {
    setTargetPage(page);
    setMobileTab('pdf');
  };

  return (
    <ChatLayout documentName={document?.name}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex border-b border-ink-200 bg-white px-3 py-2 md:hidden">
          <div className="flex w-full rounded-xl bg-surface-muted p-1">
            <button
              type="button"
              onClick={() => setMobileTab('pdf')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mobileTab === 'pdf' ? 'bg-white text-ink-950 shadow-card' : 'text-ink-500'
              }`}
            >
              PDF
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('chat')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mobileTab === 'chat' ? 'bg-white text-ink-950 shadow-card' : 'text-ink-500'
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
            onOpenPage={openPage}
            className={mobileTab === 'chat' ? 'flex' : 'hidden md:flex'}
          />
        </div>
      </div>
    </ChatLayout>
  );
}
