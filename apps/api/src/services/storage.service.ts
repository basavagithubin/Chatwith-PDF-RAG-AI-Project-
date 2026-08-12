import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const storageRoot = path.resolve(process.env.LOCAL_STORAGE_PATH ?? './storage');

export const ensureStorage = async () => {
  await fs.mkdir(storageRoot, { recursive: true });
  await fs.mkdir(path.join(storageRoot, 'tmp'), { recursive: true });
  await fs.mkdir(path.join(storageRoot, 'documents'), { recursive: true });
};

export const getDocumentFilePath = (documentId: string) => {
  return path.join(storageRoot, 'documents', `${documentId}.pdf`);
};

export const getUploadChunkPath = (documentId: string, chunkIndex: number) => {
  return path.join(storageRoot, 'tmp', documentId, `${chunkIndex}.chunk`);
};

export const getUploadTempDir = (documentId: string) => {
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
