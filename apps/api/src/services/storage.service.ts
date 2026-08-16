import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// Anchor relative storage paths to the repo root. Resolving against process.cwd()
// would scatter uploads wherever the API happened to be launched from.
// This file lives at apps/api/{src,dist}/services/, so the root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const configuredPath = process.env.LOCAL_STORAGE_PATH ?? './storage';
const storageRoot = path.isAbsolute(configuredPath)
  ? configuredPath
  : path.resolve(repoRoot, configuredPath);

export const ensureStorage = async () => {
  await fs.mkdir(storageRoot, { recursive: true });
  await fs.mkdir(path.join(storageRoot, 'tmp'), { recursive: true });
  await fs.mkdir(path.join(storageRoot, 'documents'), { recursive: true });
};

const assertSafeId = (documentId: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
    throw new Error('INVALID_ID');
  }
};

export const getDocumentFilePath = (documentId: string) => {
  assertSafeId(documentId);
  return path.join(storageRoot, 'documents', `${documentId}.pdf`);
};

export const getUploadChunkPath = (documentId: string, chunkIndex: number) => {
  assertSafeId(documentId);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 50_000) {
    throw new Error('INVALID_CHUNK_INDEX');
  }
  return path.join(storageRoot, 'tmp', documentId, `${chunkIndex}.chunk`);
};

export const getUploadTempDir = (documentId: string) => {
  assertSafeId(documentId);
  return path.join(storageRoot, 'tmp', documentId);
};

export const saveChunk = async (documentId: string, chunkIndex: number, buffer: Buffer) => {
  const directory = getUploadTempDir(documentId);
  await fs.mkdir(directory, { recursive: true });
  const chunkPath = getUploadChunkPath(documentId, chunkIndex);
  await fs.writeFile(chunkPath, buffer);
};

export const assembleUpload = async (documentId: string, chunkCount: number) => {
  const targetPath = getDocumentFilePath(documentId);
  const tempDir = getUploadTempDir(documentId);
  const output = await fs.open(targetPath, 'w');

  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const chunkPath = getUploadChunkPath(documentId, index);
      const chunkData = await fs.readFile(chunkPath);
      await output.write(chunkData);
    }
  } finally {
    await output.close();
  }

  return targetPath;
};

export const listUploadChunks = async (documentId: string) => {
  const directory = getUploadTempDir(documentId);
  try {
    const entries = await fs.readdir(directory);
    return entries.filter((name) => name.endsWith('.chunk')).map((name) => Number(name.replace('.chunk', '')));
  } catch {
    return [];
  }
};

export const cleanupUpload = async (documentId: string) => {
  const directory = getUploadTempDir(documentId);
  await fs.rm(directory, { recursive: true, force: true });
};

export const openDocumentReadStream = (documentId: string) => {
  return fs.open(getDocumentFilePath(documentId), 'r');
};

export const getStorageRoot = () => storageRoot;
