import { DragEvent, useRef, useState } from 'react';
import { uploadFileInChunks } from '../services/upload.service';

type UploadModalProps = {
  open: boolean;
  onClose: () => void;
  onUploaded: (documentId: string) => void;
};

export default function UploadModal({ open, onClose, onUploaded }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const acceptFile = (next: File | null | undefined) => {
    if (!next) return;
    if (next.type !== 'application/pdf' && !next.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.');
      return;
    }
    setError('');
    setFile(next);
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setError('');
    try {
      const documentId = await uploadFileInChunks(file, setProgress);
      setFile(null);
      setProgress(0);
      onUploaded(documentId);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-fade-up rounded-2xl bg-white p-6 shadow-lift">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Upload</p>
            <h2 className="mt-1 font-display text-xl font-semibold text-ink-950">Add a PDF to Portfhelio</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragging(false);
          }}
          onDrop={onDrop}
          className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 transition ${
            dragging
              ? 'border-brand-500 bg-brand-50'
              : 'border-ink-200 bg-surface-muted hover:border-brand-400 hover:bg-brand-50/40'
          }`}
        >
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-card">
            <svg className="h-7 w-7 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V8m0 0l-3 3m3-3l3 3M4 16.5V18a2 2 0 002 2h12a2 2 0 002-2v-1.5" />
            </svg>
          </div>
          <p className="font-medium text-ink-900">Drop your PDF here, or click to browse</p>
          <p className="mt-1 text-sm text-ink-500">PDF files only · processed for chat & concept graphs</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => acceptFile(event.target.files?.[0])}
        />

        {file && (
          <div className="mt-4 rounded-xl border border-ink-100 bg-surface-muted px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink-900">{file.name}</p>
            <p className="text-xs text-ink-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        )}

        {isUploading && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-ink-500">
              <span>Uploading</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="button" disabled={!file || isUploading} onClick={handleUpload} className="btn-primary">
            {isUploading ? `Uploading ${progress}%` : 'Upload & chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
