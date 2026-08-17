import { API_BASE } from '../lib/api.config';
import { getAccessToken } from '../lib/insforge';

const CLIENT_ID_KEY = 'portfhelio_client_id';

export class ApiError extends Error {
  status: number;
  code?: string;
  retryAfter?: number;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const getClientId = () => {
  if (typeof window === 'undefined') return 'server';
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, created);
  return created;
};

const withClientHeaders = async (headers?: HeadersInit): Promise<HeadersInit> => {
  const token = await getAccessToken();
  return {
    'X-Client-Id': getClientId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(headers || {})
  };
};

const parseRetryAfter = (body: { retryAfter?: number }, res: Response) => {
  if (body.retryAfter != null) return body.retryAfter;
  const header = Number(res.headers.get('Retry-After') || 0);
  return header > 0 ? header : undefined;
};

const request = async (input: RequestInfo, init?: RequestInit) => {
  const res = await fetch(input, {
    ...init,
    headers: await withClientHeaders(init?.headers)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      body.message ?? body.error ?? `Request failed (${res.status})`,
      res.status,
      body.error,
      parseRetryAfter(body, res)
    );
  }
  return body;
};

export const getDocuments = async () => {
  return request(`${API_BASE}/documents`);
};

export const getDocument = async (id: string) => {
  return request(`${API_BASE}/documents/${id}`);
};

export const getDocumentStatus = async (id: string) => {
  return request(`${API_BASE}/documents/${id}/status`);
};

export const createDocument = async ({ name, size, checksum, chunkCount }: { name: string; size: number; checksum: string; chunkCount: number; }) => {
  return request(`${API_BASE}/documents/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, size, checksum, chunkCount })
  });
};

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type SearchRequestOptions = {
  conversationId?: string;
  history?: ChatTurn[];
};

export const searchDocument = async (id: string, query: string, options?: SearchRequestOptions) => {
  return request(`${API_BASE}/documents/${id}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, ...options })
  });
};

export const createConversation = async (documentId: string) => {
  return request(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId })
  });
};

export const recordTrainingFeedback = async (
  documentId: string,
  payload: {
    eventType: 'edit' | 'regenerate' | 'accepted';
    question?: string;
    answer?: string;
    previousAnswer?: string;
    conversationId?: string;
    pages?: number[];
    intent?: string;
  }
) => {
  return request(`${API_BASE}/documents/${documentId}/training-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
};

export const getRateLimitStatus = async () => {
  return request(`${API_BASE}/rate-limit/status`);
};

export type SearchStreamHandlers = {
  onStart?: (event: {
    responseType: string;
    intent?: string;
    sources?: Array<{ pageNumber?: number; sourceText?: string }>;
    graph?: unknown;
    meta?: Record<string, unknown>;
    summary?: string;
  }) => void;
  onToken?: (text: string) => void;
  onDone?: (answer: string) => void;
  onError?: (message: string) => void;
};

/** Stream search answers via SSE (`data: {...}` lines). */
export const searchDocumentStream = async (
  id: string,
  query: string,
  handlers: SearchStreamHandlers,
  signal?: AbortSignal,
  options?: SearchRequestOptions
) => {
  const res = await fetch(`${API_BASE}/documents/${id}/search/stream`, {
    method: 'POST',
    headers: await withClientHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    }),
    body: JSON.stringify({ query, ...options }),
    signal
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.message ?? body.error ?? `Stream failed (${res.status})`,
      res.status,
      body.error,
      parseRetryAfter(body, res)
    );
  }
  if (!res.body) throw new Error('Streaming is not supported in this browser.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const handlePayload = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '[DONE]') return;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (event.type === 'start') {
      handlers.onStart?.(event);
    } else if (event.type === 'token' && typeof event.text === 'string') {
      handlers.onToken?.(event.text);
    } else if (event.type === 'done') {
      finished = true;
      handlers.onDone?.(typeof event.answer === 'string' ? event.answer : '');
    } else if (event.type === 'error') {
      finished = true;
      handlers.onError?.(event.message || 'Stream error');
    }
  };

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) {
          handlePayload(line.slice(5).trimStart());
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      if (line.startsWith('data:')) handlePayload(line.slice(5).trimStart());
    }
  }
};

export const getChapterGraph = async (id: string, chapterNumber: number, graphType = 'concept_map') => {
  return request(`${API_BASE}/documents/${id}/chapters/${chapterNumber}/graph`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graphType })
  });
};

export const getDocumentFileUrl = (id: string) => `${API_BASE}/documents/${id}/file`;

export const fetchDocumentFile = async (id: string) => {
  const res = await fetch(getDocumentFileUrl(id), {
    headers: await withClientHeaders({ Accept: 'application/pdf' })
  });
  if (!res.ok) {
    throw new ApiError('Unable to load the PDF.', res.status);
  }
  return res.blob();
};
