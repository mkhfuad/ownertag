/* Retention enforcement — the TTL table from the design doc, as code.
   Runs hourly inside the API process.
   ponytail: in-process interval; move to a scheduled job (cron/EventBridge)
   if you scale to multiple API instances and want exactly-once. Deletes are
   idempotent, so duplicate runs are harmless. */
import { q } from './db.js';

async function sweep() {
  await q(`DELETE FROM messages WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '72 hours'`);
  await q(`DELETE FROM messages WHERE created_at < now() - interval '7 days'`);   // undelivered stragglers
  await q(`DELETE FROM relay_sessions WHERE expires_at < now()`);
  await q(`DELETE FROM abuse_reports WHERE created_at < now() - interval '30 days'`);
}

export function startCleanup() {
  sweep().catch(err => console.error('cleanup:', err.message));
  setInterval(() => sweep().catch(err => console.error('cleanup:', err.message)), 3600_000).unref();
}
