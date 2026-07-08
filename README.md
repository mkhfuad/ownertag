# OwnerTag — Production App (Germany)

Privacy-first masked vehicle contact. Implements `../ownertag-germany-solution.md`:
opaque tag IDs → ephemeral observer sessions → moderated relay → masked delivery
(WhatsApp / email / SMS / two-leg voice bridge on German DIDs), GDPR retention enforced in code.

## Stack

Node 20 (ESM, no build step) · Express · Postgres · Redis · Twilio (EU) · Meta WhatsApp Cloud API · SMTP (SES eu-central-1).
Four runtime dependencies total. Everything else is stdlib.

## Run locally (2 minutes)

```bash
cp .env.example .env          # dev works with the defaults + docker services
docker compose up -d db redis
npm install
npm run migrate
npm test                      # self-checks: crypto, tokens, moderation
node scripts/mint-tags.js 5   # create 5 test tags, prints scan URLs
npm start                     # http://localhost:8080
```

Open a printed URL (`/t/<TAGID>`) → activate with your phone (dev mode prints the OTP
to the console instead of sending SMS) → open the same URL in a private window and
send yourself a message (dev mode logs the delivery instead of sending).

## Deploy to production

1. **Provision (all EU):** Postgres + Redis (e.g. RDS/ElastiCache `eu-central-1`, or Neon EU + Upstash EU), a container host (ECS/Fly.io/Hetzner + the provided `Dockerfile`).
2. **Secrets:** generate real keys — `openssl rand -hex 32` for `MASTER_KEY`, `HMAC_KEY`, `TOKEN_KEY`. Store in your secret manager, never in git.
3. **Twilio:** EU account, buy 2–3 **German DIDs** into `TWILIO_RELAY_NUMBERS`. Point nothing at Twilio — the app calls Twilio; Twilio calls back `${BASE_URL}/webhooks/voice/*` (URLs are passed per-call).
4. **WhatsApp:** create a Meta Business app, register the sender, submit template `ownertag_notify` (body: one text parameter). Fill `WA_*` vars. Approval takes ~1–2 weeks — SMS/email carry traffic meanwhile.
5. **Email:** SES `eu-central-1` SMTP credentials (or any EU SMTP) → `SMTP_*`.
6. **Turnstile:** create a widget, set `TURNSTILE_SECRET`, and add the site key + script tag to `public/scan.html` (`ts-widget` div is ready; callback `onTurnstile`). Empty secret = captcha disabled (dev only).
7. **TLS + domain:** run behind a TLS-terminating proxy (Cloudflare/ALB/Caddy). Set `BASE_URL=https://ownertag.de`. HSTS is already sent by the app.
8. `docker compose up -d` (or push the image) — migrations run on boot.
9. **Mint real tags:** `node scripts/mint-tags.js 500 > batch.csv` → print QR codes from the URLs (tamper-evident sticker stock).

## Before go-live (legal, Germany)

Impressum + Datenschutzerklärung pages (placeholders linked in `public/index.html`),
AVV/DPA signed with Twilio, Meta/BSP, AWS; Art. 30 records + DPIA on file;
breach runbook (72 h, competent state DPA). See `../ownertag-germany-solution.md` §5.

## Architecture map

```
src/server.js      Express app, security headers, static PWA, error handling
src/routes.js      All API endpoints (scan, message, call, activate, dashboard, GDPR)
src/shop.js        Order intake (/shop page) + admin order list/status (ADMIN_KEY-guarded)
src/webhooks.js    Twilio TwiML — two-leg masked voice bridge with whisper-accept
src/crypto.js      AES-256-GCM field encryption, HMAC lookup, tag IDs, signed tokens
src/notify.js      ONLY module that decrypts contact data; channel fallback chain
src/moderation.js  Strip URLs/phones/emails → DE/EN/TR lexicon → (LLM hook)
src/ratelimit.js   Redis counters: per-tag / per-observer / per-pair / scan
src/cleanup.js     Hourly TTL sweeps — the retention policy, as code
migrations/        Schema (all contact fields encrypted at rest)
public/            scan page, activation, owner dashboard (vanilla JS, no build)
scripts/mint-tags.js  Batch-create tags for printing
```

## Deliberate simplifications (ponytail ledger)

- `crypto.js`: master-key AES-GCM → upgrade to KMS envelope encryption (per-record data keys) at compliance review.
- `ratelimit.js`: fixed window → sliding window if abuse data demands it.
- `cleanup.js`: in-process hourly sweep → external cron when running multiple instances.
- `scan.js`: 15 s inbox polling → SSE when reply volume justifies it.
- ~~Twilio signature validation~~ → done: `webhooks.js` rejects requests without a valid `X-Twilio-Signature`.
- Inbound SMS webhook for long-code replies not wired → observers read replies via the inbox page; add when masked-SMS threads become a used path.
- Shop has no payment gateway → Rechnung/Vorkasse manual flow; add Stripe Checkout (one endpoint + webhook) when order volume justifies it.
