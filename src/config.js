const need = (k, dev) => {
  const v = process.env[k];
  if (!v && process.env.NODE_ENV === 'production' && dev === undefined)
    throw new Error(`Missing required env: ${k}`);
  return v || dev || '';
};

export const config = {
  port: Number(process.env.PORT || 8080),
  baseUrl: process.env.BASE_URL || 'http://localhost:8080',
  databaseUrl: need('DATABASE_URL', 'postgres://ownertag:ownertag@localhost:5432/ownertag'),
  redisUrl: need('REDIS_URL', 'redis://localhost:6379'),
  masterKey: need('MASTER_KEY', '0'.repeat(64)),   // dev fallback only
  hmacKey: need('HMAC_KEY', '1'.repeat(64)),
  tokenKey: need('TOKEN_KEY', '2'.repeat(64)),
  turnstileSecret: process.env.TURNSTILE_SECRET || '',
  twilio: {
    sid: process.env.TWILIO_ACCOUNT_SID || '',
    token: process.env.TWILIO_AUTH_TOKEN || '',
    relayNumbers: (process.env.TWILIO_RELAY_NUMBERS || '').split(',').filter(Boolean),
    smsSender: process.env.TWILIO_SMS_SENDER || 'OWNERTAG',
  },
  whatsapp: {
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
    accessToken: process.env.WA_ACCESS_TOKEN || '',
    template: process.env.WA_TEMPLATE_NOTIFY || 'ownertag_notify',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'OwnerTag <no-reply@ownertag.de>',
  },
};
