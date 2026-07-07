/* Mint a batch of unactivated tags for production printing.
   Usage: node scripts/mint-tags.js 500 > batch.csv
   Output: CSV of tag_id,url — feed to your print partner / QR generator. */
import { q, pool } from '../src/db.js';
import { newTagId } from '../src/crypto.js';

const n = Number(process.argv[2] || 10);
const base = process.env.BASE_URL || 'https://ownertag.de';

console.log('tag_id,url');
for (let i = 0; i < n; i++) {
  const id = newTagId();
  const r = await q(`INSERT INTO tags (tag_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING tag_id`, [id]);
  if (r.rowCount) console.log(`${id},${base}/t/${id}`);
  else i--;                       // collision (astronomically rare): retry
}
await pool.end();
