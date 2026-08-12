import fs from 'fs/promises';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../utils/database.utils.js';
import { getDocumentFilePath, ensureStorage } from './storage.service.js';
import { createChunksForPage } from './chunking.service.js';
import { OCRProvider, createOcrProvider, reconstructPageText } from '../ai/ocr.provider.js';
import { embeddingQueue } from '../queues/queues.js';

const MIN_TEXT_LENGTH_FOR_OCR = 80;

export const validatePdfFile = async (documentId: string) => {
  const filePath = getDocumentFilePath(documentId);
  const buffer = await fs.readFile(filePath);
  if (!buffer.slice(0, 4).equals(Buffer.from('%PDF'))) {
    throw new Error('INVALID_PDF');
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), password: '' });
  const document = await loadingTask.promise;
  if (document.numPages <= 0) {
    throw new Error('UNSUPPORTED_PDF');
  }
  await document.destroy();
  return true;
};

const getPageText = async (pdfDocument: pdfjsLib.PDFDocumentProxy, pageNumber: number) => {
  const page = await pdfDocument.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const reconstructed = reconstructPageText(textContent.items as any);
  if (reconstructed.length >= 20) return reconstructed;
  const fallback = textContent.items.map((item: any) => item.str).join(' ').trim();
  return fallback;
};

export const processDocument = async (documentId: string) => {
  await ensureStorage();
  const db = getDatabase();
  const filePath = getDocumentFilePath(documentId);
  const fileBuffer = await fs.readFile(filePath);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer), verbosity: 0 });
  const pdfDocument = await loadingTask.promise;
  const pageCount = pdfDocument.numPages;

  await db.query('UPDATE documents SET page_count=$2, status=$3 WHERE id=$1', [documentId, pageCount, 'EXTRACTING']);
  await db.query(
    'INSERT INTO processing_jobs (id, document_id, stage, progress) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET stage=$3, progress=$4, updated_at=now()',
    [documentId, documentId, 'EXTRACTING', 0]
  );

  const ocrProvider: OCRProvider = createOcrProvider();
  let chunkIndex = 0;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    try {
      const existingPage = await db.query('SELECT id, processing_status FROM document_pages WHERE document_id=$1 AND page_number=$2', [documentId, pageNumber]);
      if (existingPage.rowCount && existingPage.rows[0].processing_status === 'COMPLETED') {
        continue;
      }

      const rawText = await getPageText(pdfDocument, pageNumber);
      let pageText = rawText;
      if (pageText.length < MIN_TEXT_LENGTH_FOR_OCR) {
        const ocrText = await ocrProvider.extractTextFromPdfPage(filePath, pageNumber, rawText);
        if (ocrText.trim().length > pageText.length) {
          pageText = ocrText.trim();
        }
      }

      const wordCount = pageText.split(/\s+/).filter(Boolean).length;
      const pageId = existingPage.rowCount ? existingPage.rows[0].id : uuidv4();
      await db.query(
        'INSERT INTO document_pages (id, document_id, page_number, text, word_count, processing_status) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET text=$4, word_count=$5, processing_status=$6',
        [pageId, documentId, pageNumber, pageText, wordCount, 'COMPLETED']
      );

      const pageChunks = createChunksForPage(documentId, pageNumber, pageText, chunkIndex);
      for (const chunk of pageChunks) {
        const chunkId = uuidv4();
        await db.query(
          'INSERT INTO document_chunks (id, document_id, page_number, chunk_index, content, token_count, section) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
          [chunkId, documentId, pageNumber, chunk.chunkIndex, chunk.content, chunk.tokenCount, chunk.section ?? null]
        );
      }
      chunkIndex += pageChunks.length;
      await db.query('UPDATE processing_jobs SET progress=$2, stage=$3, updated_at=now() WHERE document_id=$1', [documentId, Math.round((pageNumber / pageCount) * 100), 'EXTRACTING']);
    } catch (error) {
      await db.query('INSERT INTO processing_errors (id, document_id, page_number, error) VALUES ($1, $2, $3, $4)', [ `${documentId}-${pageNumber}-${Date.now()}`, documentId, pageNumber, String(error)]);
    }
  }

  await pdfDocument.destroy();
  await db.query('UPDATE documents SET status=$2 WHERE id=$1', [documentId, 'CHUNKING']);
  await db.query('UPDATE processing_jobs SET stage=$2, progress=$3, updated_at=now() WHERE document_id=$1', [documentId, 'CHUNKING', 100]);

  await embeddingQueue.add('document-embedding', { documentId });
};
