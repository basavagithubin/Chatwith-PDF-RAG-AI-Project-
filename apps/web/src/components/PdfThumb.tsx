import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getDocumentFileUrl } from '../services/documents.service';
import { displayTitle } from '../lib/library.prefs';

type PdfThumbProps = {
  documentId: string;
  name: string;
  sourceAvailable?: boolean;
  className?: string;
};

const accentFor = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hues = [168, 186, 200, 152, 175];
  return hues[hash % hues.length];
};

export default function PdfThumb({ documentId, name, sourceAvailable = true, className = '' }: PdfThumbProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(!sourceAvailable);
  const title = displayTitle(name);
  const hue = accentFor(documentId);

  useEffect(() => {
    if (!sourceAvailable || failed || src) return;
    const node = hostRef.current;
    if (!node) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();

        void (async () => {
          try {
            const pdfjs = await import('pdfjs-dist/build/pdf');
            // pdfjs-dist CJS/ESM interop varies by bundler.
            const lib = (pdfjs as any).default ?? pdfjs;
            if (lib.GlobalWorkerOptions) {
              lib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
            }

            const loadingTask = lib.getDocument(getDocumentFileUrl(documentId));
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1 });
            const targetWidth = 220;
            const scale = targetWidth / viewport.width;
            const scaled = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(scaled.width);
            canvas.height = Math.ceil(scaled.height);
            const context = canvas.getContext('2d');
            if (!context) throw new Error('No canvas context');

            await page.render({ canvasContext: context, viewport: scaled }).promise;
            objectUrl = canvas.toDataURL('image/jpeg', 0.82);
            if (!cancelled) setSrc(objectUrl);
            await pdf.destroy?.();
          } catch {
            if (!cancelled) setFailed(true);
          }
        })();
      },
      { rootMargin: '120px' }
    );

    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [documentId, failed, sourceAvailable, src]);

  return (
    <div
      ref={hostRef}
      className={`relative overflow-hidden rounded-[12px] bg-ink-100 ${className.includes('h-') ? className : `aspect-[3/4] ${className}`}`}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
      ) : (
        <div
          className="flex h-full w-full flex-col justify-between p-3 dark:[background:linear-gradient(160deg,hsl(var(--thumb-h)_18%_22%),hsl(var(--thumb-h)_16%_16%)_55%,hsl(var(--thumb-h)_14%_12%))]"
          style={
            {
              '--thumb-h': String(hue),
              background: `linear-gradient(160deg, hsl(${hue} 28% 94%), hsl(${hue} 22% 88%) 55%, hsl(${hue} 18% 82%))`
            } as CSSProperties
          }
        >
          <div className="flex items-start justify-between">
            <span className="rounded-md bg-surface/85 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-danger-700 ring-1 ring-ink-200/60">
              PDF
            </span>
            {!failed && <span className="h-2 w-2 animate-soft-pulse rounded-full bg-brand-500/70" />}
          </div>
          <div>
            <p className="line-clamp-3 font-display text-[13px] font-semibold leading-snug text-ink-900">{title}</p>
            <div className="mt-3 space-y-1.5">
              <div className="h-1 w-[80%] rounded-full bg-ink-950/10 dark:bg-ink-50/10" />
              <div className="h-1 w-[60%] rounded-full bg-ink-950/10 dark:bg-ink-50/10" />
              <div className="h-1 w-[66%] rounded-full bg-ink-950/10 dark:bg-ink-50/10" />
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 rounded-[12px] ring-1 ring-inset ring-ink-950/5" />
    </div>
  );
}
