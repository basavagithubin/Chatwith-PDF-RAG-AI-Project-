const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api';
const CHUNK_SIZE = Number(import.meta.env.VITE_UPLOAD_CHUNK_SIZE ?? 10_485_760);

export const initUpload = async ({ name, size, checksum, chunkCount }: { name: string; size: number; checksum: string; chunkCount: number; }) => {
  const response = await fetch(`${API_BASE}/documents/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, size, checksum, chunkCount })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? body.error ?? `Upload initialization failed (${response.status})`);
  return body;
};

export const uploadChunk = async ({ documentId, chunkIndex, chunk }: { documentId: string; chunkIndex: number; chunk: Blob; }) => {
  const response = await fetch(`${API_BASE}/documents/upload/chunk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-document-id': documentId,
      'x-chunk-index': String(chunkIndex)
    },
    body: chunk
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? body.error ?? `Chunk upload failed (${response.status})`);
  return body;
};

export const completeUpload = async (documentId: string) => {
  const response = await fetch(`${API_BASE}/documents/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? body.error ?? `Upload completion failed (${response.status})`);
  return body;
};

export const uploadFileInChunks = async (file: File, onProgress: (progress: number) => void) => {
  const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
  const checksum = await computeSha256(file);
  const initResponse = await initUpload({ name: file.name, size: file.size, checksum, chunkCount });
  const documentId = initResponse.documentId;
  if (initResponse.duplicate) {
    onProgress(100);
    return documentId;
  }

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CHUNK_SIZE;
    const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
    await uploadChunk({ documentId, chunkIndex: index, chunk });
    onProgress(Math.round(((index + 1) / chunkCount) * 100));
  }

  await completeUpload(documentId);
  return documentId;
};

const computeSha256 = async (file: File) => {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
};
