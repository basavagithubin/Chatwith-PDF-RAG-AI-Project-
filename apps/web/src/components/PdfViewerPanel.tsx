import { useState } from 'react';
import { Worker, Viewer } from '@react-pdf-viewer/core';
import '@react-pdf-viewer/core/lib/styles/index.css';
import { DownloadIcon, ZoomInIcon, ZoomOutIcon } from './Icons';

type PdfViewerPanelProps = {
  fileUrl: string;
  documentName?: string;
  pageCount?: number | null;
  status?: string;
  targetPage?: number | null;
  className?: string;
};

export default function PdfViewerPanel({
  fileUrl,
  documentName,
  pageCount,
  status,
  targetPage,
  className = ''
}: PdfViewerPanelProps) {
  const [scale, setScale] = useState(1);
  const isReady = status === 'READY';
  const isFailed = status === 'FAILED' || status === 'CANCELLED';
  const initialPage = Math.max(0, (targetPage ?? 1) - 1);

  return (
    <section className={`relative flex min-w-0 flex-1 flex-col bg-surface-canvas ${className}`}>
      {!isReady && !isFailed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-canvas/90">
          <div className="rounded-2xl bg-surface px-8 py-6 text-center shadow-toolbar">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            <p className="font-display font-semibold text-ink-950">Processing document…</p>
            <p className="mt-1 text-sm text-ink-500">Status: {status ?? 'Loading'}</p>
          </div>
        </div>
      )}

      {isFailed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-canvas/90">
          <div className="max-w-sm rounded-2xl bg-surface px-8 py-6 text-center shadow-toolbar">
            <p className="font-display font-semibold text-ink-950">Processing failed</p>
            <p className="mt-2 text-sm text-ink-500">
              This PDF could not be processed. Try uploading again or reprocessing from your library.
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-3xl">
          {isReady ? (
            <div className="overflow-hidden rounded-xl bg-surface shadow-lift">
              <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
                <Viewer
                  key={`${fileUrl}-${targetPage ?? 1}`}
                  fileUrl={fileUrl}
                  defaultScale={scale}
                  initialPage={initialPage}
                />
              </Worker>
            </div>
          ) : (
            <div className="flex min-h-[480px] items-center justify-center rounded-xl bg-surface/70 shadow-card">
              <div className="p-8 text-center text-ink-400">
                <p className="font-display text-lg font-semibold text-ink-700">{documentName ?? 'PDF Preview'}</p>
                <p className="mt-2 text-sm">Your document will appear here once ready</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {isReady && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-ink-200 bg-surface/95 px-3 py-2 shadow-toolbar backdrop-blur">
            <button
              type="button"
              onClick={() => setScale((value) => Math.max(0.5, value - 0.1))}
              className="rounded-full p-2 text-ink-600 hover:bg-ink-100"
              aria-label="Zoom out"
            >
              <ZoomOutIcon />
            </button>
            <span className="min-w-[3rem] text-center text-sm font-medium text-ink-700">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale((value) => Math.min(2, value + 0.1))}
              className="rounded-full p-2 text-ink-600 hover:bg-ink-100"
              aria-label="Zoom in"
            >
              <ZoomInIcon />
            </button>
            <div className="mx-1 h-5 w-px bg-ink-200" />
            <span className="px-2 text-sm text-ink-600">
              {typeof targetPage === 'number' ? `Page ${targetPage}` : `${pageCount ?? '—'} pages`}
            </span>
            <div className="mx-1 h-5 w-px bg-ink-200" />
            <a
              href={fileUrl}
              download={documentName}
              className="rounded-full p-2 text-ink-600 hover:bg-ink-100"
              aria-label="Download"
            >
              <DownloadIcon />
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
