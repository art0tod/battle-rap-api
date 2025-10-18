import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');

async function main() {
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
  });
  await client.connect();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  logger.info({ files }, 'Running migrations');

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info({ file }, 'Applying migration');
    await client.query(sql);
  }

  await client.end();
  logger.info('Migrations complete');
}

main().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exitCode = 1;
});
