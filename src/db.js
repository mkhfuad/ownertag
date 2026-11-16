import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
/* Without a listener, an idle client dropped by a Postgres restart emits an
   unhandled 'error' and kills the process. */
pool.on('error', (err) => console.error('pg idle client error:', err.code || err.message));
export const q = (text, params) => pool.query(text, params);
