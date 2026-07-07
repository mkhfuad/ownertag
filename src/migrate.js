import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
try {
  for (const f of readdirSync(dir).sort()) {
    process.stdout.write(`migrate: ${f}\n`);
    await pool.query(readFileSync(join(dir, f), 'utf8'));
  }
} catch (err) {
  if (err.code === 'ECONNREFUSED') {
    console.error('\nPostgres is not reachable. Start it first:\n  docker compose up -d db redis\nthen re-run: npm run migrate\n');
    process.exit(1);
  }
  throw err;
}
await pool.end();
