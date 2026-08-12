import fs from 'fs/promises';
import path from 'path';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import '../config/env.js';

export interface OCRProvider {
  extractTextFromPdfPage(filePath: string, pageNumber: number, fallbackText?: string): Promise<string>;
}

/**
 * Prefer keeping sparse PDF text over inventing placeholder OCR strings.
 * When optional native deps (canvas + tesseract) are available, attempt real OCR.
 */
export class BuiltinOCRProvider implements OCRProvider {
  async extractTextFromPdfPage(filePath: string, pageNumber: number, fallbackText = '') {
    const ocrText = await tryTesseractOcr(filePath, pageNumber);
    if (ocrText && ocrText.trim().length > fallbackText.trim().length) {
      return ocrText.trim();
    }
    return fallbackText.trim();
  }
}

/**
 * Load a canvas implementation. `@napi-rs/canvas` ships prebuilt binaries, so it
 * is tried first; plain `canvas` needs a native toolchain and is only a fallback.
 */
const loadCreateCanvas = async (): Promise<((w: number, h: number) => any) | null> => {
  const napi = await import('@napi-rs/canvas').catch(() => null as any);
  if (napi?.createCanvas) {
    // pdf.js only auto-polyfills these from the native `canvas` package, which we
    // avoid because it needs a compiler toolchain. Supply them from napi-rs.
    const globals = globalThis as Record<string, unknown>;
    for (const name of ['DOMMatrix', 'Path2D', 'ImageData'] as const) {
      if (!globals[name] && napi[name]) globals[name] = napi[name];
    }
    return napi.createCanvas;
  }

  const legacy = await import('canvas').catch(() => null as any);
  if (legacy?.createCanvas) return legacy.createCanvas;
  return null;
};

/**
 * pdf.js falls back to its own factory that `require`s the native `canvas`
 * package. Supplying a factory keeps rendering on the prebuilt implementation.
 */
const buildCanvasFactory = (createCanvas: (w: number, h: number) => any) => ({
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext('2d') };
  },
  reset(entry: { canvas: any }, width: number, height: number) {
    entry.canvas.width = Math.max(1, width);
    entry.canvas.height = Math.max(1, height);
  },
  destroy(entry: { canvas: any; context: any }) {
    if (entry.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    entry.canvas = null;
    entry.context = null;
  }
});

const ocrScale = () => {
  const scale = Number(process.env.OCR_RENDER_SCALE || 2);
  return Number.isFinite(scale) && scale > 0 ? Math.min(scale, 4) : 2;
};

const tryTesseractOcr = async (filePath: string, pageNumber: number): Promise<string | null> => {
  try {
    // Optional dependency path — skip quietly when canvas/tesseract are unavailable.
    const [tesseract, createCanvas] = await Promise.all([
      import('tesseract.js').catch(() => null as any),
      loadCreateCanvas()
    ]);
    const createWorker = tesseract?.createWorker ?? tesseract?.default?.createWorker;
    if (!createWorker || !createCanvas) return null;

    const buffer = await fs.readFile(filePath);
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0,
      canvasFactory: buildCanvasFactory(createCanvas)
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: ocrScale() });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');

    // pdf.js draws with transparency; OCR needs an opaque white background.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context as any, viewport }).promise;

    const png: Buffer = canvas.toBuffer('image/png');
    const worker = await createWorker(process.env.OCR_LANGUAGE || 'eng');
    try {
      const result = await worker.recognize(png);
      return result?.data?.text?.trim() || null;
    } finally {
      await worker.terminate().catch(() => undefined);
      await pdf.destroy().catch(() => undefined);
    }
  } catch (error) {
    console.warn(`OCR unavailable for page ${pageNumber}:`, error instanceof Error ? error.message : error);
    return null;
  }
};

export const createOcrProvider = (): OCRProvider => new BuiltinOCRProvider();

/** Reconstruct readable page text from pdf.js text items using positions. */
export const reconstructPageText = (items: Array<{ str?: string; transform?: number[]; width?: number }>) => {
  if (!items?.length) return '';

  type LineItem = { x: number; text: string };
  const lines = new Map<number, LineItem[]>();

  for (const item of items) {
    const text = (item.str || '').replace(/\s+/g, ' ');
    if (!text.trim()) continue;
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const x = Number(transform[4] || 0);
    const y = Math.round(Number(transform[5] || 0));
    const bucket = Math.round(y / 3) * 3;
    const list = lines.get(bucket) || [];
    list.push({ x, text });
    lines.set(bucket, list);
  }

  const orderedYs = Array.from(lines.keys()).sort((a, b) => b - a);
  const output: string[] = [];
  for (const y of orderedYs) {
    const row = (lines.get(y) || []).sort((a, b) => a.x - b.x);
    const line = row.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
    if (line) output.push(line);
  }
  return output.join('\n').trim();
};

// Keep unused import usable for typed dynamic path consumers.
void path;
