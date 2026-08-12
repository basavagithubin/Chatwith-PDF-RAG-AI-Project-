import '../config/env.js';
import { Worker } from 'bullmq';
import { getDatabase } from '../utils/database.utils.js';
import { processDocument, validatePdfFile } from '../services/pdf.service.js';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

const worker = new Worker('pdf-processing', async (job) => {
  const { documentId } = job.data;
  await validatePdfFile(documentId);
  await processDocument(documentId);
}, { connection: connection as any });

worker.on('failed', async (job, err) => {
  console.error('PDF worker failed', job?.id, err);
  const documentId = job?.data?.documentId;
  if (!documentId) return;
  try {
    await getDatabase().query('UPDATE documents SET status=$2 WHERE id=$1', [documentId, 'FAILED']);
  } catch (updateError) {
    console.error('Unable to mark document as failed', updateError);
  }
});

worker.on('completed', (job) => {
  console.log('PDF worker completed', job.id);
});
