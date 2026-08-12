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

const tryTesseractOcr = async (filePath: string, pageNumber: number): Promise<string | null> => {
  try {
    // Optional dependency path — skip quietly when canvas/tesseract are unavailable.
    const [{ createWorker }, canvasMod] = await Promise.all([
      import('tesseract.js').catch(() => null as any),
      import('canvas').catch(() => null as any)
    ]);
    if (!createWorker || !canvasMod?.createCanvas) return null;

    const buffer = await fs.readFile(filePath);
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context as any, viewport }).promise;

    const worker = await createWorker('eng');
    const result = await worker.recognize(canvas.toBuffer('image/png'));
    await worker.terminate();
    await pdf.destroy();
    return result?.data?.text?.trim() || null;
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
