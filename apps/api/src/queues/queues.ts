import { Queue } from 'bullmq';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisConnection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379'
};

export const pdfQueue = new Queue('pdf-processing', { connection: redisConnection as any });
export const embeddingQueue = new Queue('embedding-processing', { connection: redisConnection as any });

export const initQueues = async () => {
  const client = createClient(redisConnection);
  await client.connect();
  await client.disconnect();
};
