import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
try {
  /* Ledger: each file runs once, ever. Previously every file re-ran on every
     boot — idempotent, but wasteful and it re-took index locks on each deploy. */
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const done = new Set(rows.map(r => r.filename));

  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    if (done.has(f)) { process.stdout.write(`migrate: ${f} (skip, applied)\n`); continue; }
    process.stdout.write(`migrate: ${f}\n`);
    /* Strip `--` line comments first (so a ';' inside a comment can't split a
       statement), then one statement per query with NO wrapping transaction — so
       CREATE INDEX CONCURRENTLY (illegal inside a transaction block) works and
       deploys stay non-locking. ponytail: no dollar-quoted function bodies in
       these migrations; revisit the splitter if one is ever added. */
    const sql = readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean))
      await pool.query(stmt);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
  }
} catch (err) {
  if (err.code === 'ECONNREFUSED') {
    console.error('\nPostgres is not reachable. Start it first:\n  docker compose up -d db redis\nthen re-run: npm run migrate\n');
    process.exit(1);
  }
  throw err;
}
await pool.end();
