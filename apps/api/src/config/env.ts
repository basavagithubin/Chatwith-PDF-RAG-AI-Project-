import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '../..');
const projectRoot = path.resolve(apiRoot, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(apiRoot, '.env') });
dotenv.config();

const inContainer = process.env.CONTAINER === '1';
const storagePath = process.env.LOCAL_STORAGE_PATH ?? 'storage';
if (!path.isAbsolute(storagePath)) {
  process.env.LOCAL_STORAGE_PATH = path.resolve(inContainer ? process.cwd() : projectRoot, storagePath);
}

export { projectRoot, apiRoot };
