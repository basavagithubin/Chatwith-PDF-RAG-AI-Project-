import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const storagePath = process.env.LOCAL_STORAGE_PATH ?? 'storage';
if (!path.isAbsolute(storagePath)) {
  process.env.LOCAL_STORAGE_PATH = path.join(projectRoot, storagePath);
}

export { projectRoot };
