const PROD = process.env.NODE_ENV === 'production';
/* In production a missing required var is a hard boot failure and any `dev`
   fallback is ignored entirely. Outside production the fallback (if any) is
   used, so local dev/tests run without every var set. Sensitive crypto/data
   keys are declared WITHOUT a fallback below — they must be supplied via .env
   or explicit environment variables in every environment. */
const need = (k, dev) => {
  const v = process.env[k];
  if (!v && PROD) throw new Error(`Missing required env: ${k}`);
  return v || (PROD ? '' : dev) || '';
};

export const config = {
  port: Number(process.env.PORT || 8080),
  baseUrl: process.env.BASE_URL || 'http://localhost:8080',
  // No dev fallbacks for data/crypto keys — supply them via .env locally.
  databaseUrl: need('DATABASE_URL'),
  redisUrl: need('REDIS_URL'),
  masterKey: need('MASTER_KEY'),
  hmacKey: need('HMAC_KEY'),
  tokenKey: need('TOKEN_KEY'),
  turnstileSecret: process.env.TURNSTILE_SECRET || '',
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',   // public — sent to the scan page
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

/* Belt-and-suspenders: never run in production on a known dev key, even if
   something re-introduces a fallback path. */
if (PROD) {
  const devKeys = { masterKey: '0'.repeat(64), hmacKey: '1'.repeat(64), tokenKey: '2'.repeat(64) };
  for (const [k, dev] of Object.entries(devKeys))
    if (config[k] === dev) throw new Error(`Refusing to start: ${k} is the insecure dev default`);
}
