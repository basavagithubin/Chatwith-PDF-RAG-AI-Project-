import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { RedisMemoryServer } from 'redis-memory-server';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, '.data', 'pglite');
const postgresPort = Number(process.env.POSTGRES_PORT ?? 5432);
const redisPort = Number(process.env.REDIS_PORT ?? 6379);

fs.mkdirSync(dataDir, { recursive: true });

const db = new PGlite({
  dataDir,
  extensions: { vector }
});

const pgServer = new PGLiteSocketServer({
  db,
  host: '127.0.0.1',
  port: postgresPort,
  maxConnections: 10
});

const redisServer = new RedisMemoryServer({
  instance: {
    port: redisPort,
    ip: '127.0.0.1'
  }
});

await pgServer.start();
await redisServer.start();

console.log(`Dev Postgres (PGlite + pgvector) listening on 127.0.0.1:${postgresPort}`);
console.log(`Dev Redis listening on 127.0.0.1:${redisPort}`);
console.log('Press Ctrl+C to stop dev services.');

const shutdown = async () => {
  console.log('\nStopping dev services...');
  await pgServer.stop?.().catch(() => undefined);
  await redisServer.stop().catch(() => undefined);
  await db.close?.().catch(() => undefined);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
