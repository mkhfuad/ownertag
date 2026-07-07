import Redis from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

let warned = false;
redis.on('error', (err) => {
  if (!warned) {
    console.error(`redis unreachable (${err.code}) — is it running? Try: docker compose up -d db redis`);
    warned = true;             // one clear line instead of an endless retry spam
  }
});
