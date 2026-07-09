# OwnerTag — Pre-Deployment Audit

**Scope:** `ownertag-app/` (~1,300 LOC: Express API, static PWA frontend, Postgres/Redis, Twilio/WhatsApp/SMTP relay).
**Date:** 2026-07-08. **Verdict:** Solid, security-conscious codebase — but **do not deploy until the 3 Critical items below are fixed.** Two of them are silent-failure modes that the happy-path Render deploy hides.

---

## Critical Risks — must fix before deploy

### C1. Production can boot with an all-zeros encryption key (silent PII compromise)
`src/config.js` — the env guard is inverted. It only throws when a var has **no** dev fallback:

```js
const need = (k, dev) => {
  if (!v && process.env.NODE_ENV === 'production' && dev === undefined)  // ← dev===undefined
    throw new Error(`Missing required env: ${k}`);
  return v || dev || '';
};
masterKey: need('MASTER_KEY', '0'.repeat(64)),   // dev fallback provided → guard NEVER fires
```

Because `MASTER_KEY`, `HMAC_KEY`, `TOKEN_KEY`, `DATABASE_URL`, and `REDIS_URL` all pass a dev fallback, the "required in production" check is dead code for exactly the values that matter. A production boot with `MASTER_KEY` unset does **not** crash — it encrypts every phone, email, and plate with the publicly-known `000…0` key. `render.yaml` masks this by auto-generating the keys, so only the blessed path is safe; any Docker/self-host/misconfigured deploy is a data-confidentiality failure with no error.

**Fix:** make the secret keys hard-required in production regardless of fallback.
```js
const need = (k, dev) => {
  const v = process.env[k];
  if (!v && process.env.NODE_ENV === 'production')
    throw new Error(`Missing required env: ${k}`);
  return v || dev || '';
};
// call the crypto/data keys WITHOUT a dev fallback so local dev still needs a .env,
// or keep a separate `devOnly()` helper used only for genuinely optional vars.
```
Add a startup assertion that `MASTER_KEY !== '0'.repeat(64)` in prod as a belt-and-suspenders guard.

### C2. OTP codes use `Math.random()` — predictable, and OTP is the *only* auth factor
`src/routes.js:55`:
```js
const code = String(Math.floor(100000 + Math.random() * 900000));
```
`Math.random()` is not a CSPRNG; its internal state is recoverable from observed outputs. The 6-digit code is the sole gate for **account login, activation, and account takeover**. Predictable OTP generation undermines the entire auth model.

**Fix (stdlib, one line):**
```js
import { randomInt } from 'node:crypto';
const code = String(randomInt(100000, 1000000));
```

### C3. `/healthz` reports healthy while the DB is down
`src/server.js` — `app.get('/healthz', (_req, res) => res.json({ ok: true }))` is a static literal. Render's `healthCheckPath` and any load balancer will keep routing traffic to an instance whose Postgres/Redis connection is dead, turning a dependency blip into served 500s instead of a drained instance.

**Fix:** make it a real readiness probe.
```js
app.get('/healthz', async (_req, res) => {
  try { await q('SELECT 1'); await redis.ping(); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});
```
Keep a separate static `/livez` if you want liveness vs. readiness split.

---

## Warnings — should fix soon

### W1. Redis is an undeclared hard dependency for the core "someone at a car" path
The tag-state cache read is defensively wrapped (`redis.get(...).catch(() => null)` → falls back to Postgres), **but the rate-limit gate is not**: `checkScanLimits → hit() → redis.incr()` is unguarded. A Redis outage throws inside every `/api/tags/:id`, `/messages`, and `/call` request → the primary user journey 500s even though the data is in Postgres. OTP/login also die (expected), but scan failing on a Redis hiccup contradicts the "warm scans skip Postgres" resilience goal. **Fix:** fail-open on rate-limit errors for the scan path (`hit()` returns `true` on Redis error), or wrap `checkScanLimits` so a Redis outage degrades to "no limiting" rather than "no service."

### W2. Unauthenticated telephony + email abuse vectors
- `/api/call` places a real Twilio call to an **attacker-supplied, unverified** `phone`. Someone can make OwnerTag ring an arbitrary victim (harassment) and burn Twilio credit. Guarded only by tag/fingerprint rate limits (2/tag/h, 3/fp/10min), and fingerprint = `sha256(IP|UA)` is trivially rotated.
- `/api/orders` emails an arbitrary `email` a confirmation (spam/email-bomb relay), same weak fingerprint limit.

Neither is catastrophic but both are real, cost-bearing abuse channels. **Fix:** require a passed Turnstile before `/call` amplifies to telephony (already wired — just make it mandatory, i.e. don't let empty `TURNSTILE_SECRET` disable it in prod); consider a short cool-down keyed on the destination number, not just the caller fingerprint.

### W3. Migrations lock tables and re-run every boot
`src/migrate.js` executes every `.sql` file on every container start with **no tracking table**, and indexes use plain `CREATE INDEX` (not `CONCURRENTLY`). On an empty/small DB this is fine and idempotent (`IF NOT EXISTS`), but once `messages`/`relay_sessions` have volume, `004_hot_indexes.sql` will take an `ACCESS EXCLUSIVE`-adjacent lock and block writes during deploy — the opposite of the zero-downtime goal you asked about. **Fix before the table is large:** switch new indexes to `CREATE INDEX CONCURRENTLY` (must run outside the multi-statement transaction — one statement per file), and add a `schema_migrations(filename)` ledger so applied files are skipped.

### W4. GDPR erasure leaves relay data behind
`DELETE /api/owner/account` resets tags to `unactivated` and `DELETE FROM owners`, but **tags are not deleted** — so `relay_sessions` and `messages` (which reference tags, `ON DELETE CASCADE`) are *not* cascaded away, contrary to the code comment. In practice the hourly `cleanup.js` TTL purges them within 24–72h, but at the moment of an Art. 17 erasure request the observer callback numbers and message bodies still exist. `abuse_reports` snapshots (30-day hold) also survive erasure. **Fix:** on account deletion, explicitly delete `relay_sessions`/`messages` for the owner's tags in the same transaction; document the abuse_reports legal-hold exception in your Datenschutzerklärung.

### W5. Admin secret travels in the URL query string
All `/api/admin/*` routes authenticate via `?key=ADMIN_KEY`, and `print_url` embeds it. Query strings land in server/proxy access logs, browser history, and `Referer` headers. The key is 128-bit random so guessing/timing isn't the risk — **leakage** is. `mint` and `reset-limits` are also state-changing operations exposed over `GET` (CSRF-able / prefetchable if the key ever leaks). **Fix:** accept the key via `Authorization` header (or a signed admin cookie), and make mutating admin ops `POST`. At minimum, compare with `timingSafeEqual` and set `Cache-Control: no-store` on admin responses.

### W6. Concurrent first-time activation with the same phone → unhandled 500
`/api/activate/verify` does `SELECT owner … ; owner ??= INSERT INTO owners …`. Two simultaneous activations for a new phone both miss the SELECT and race the INSERT; the second hits the `phone_hmac` UNIQUE constraint and surfaces as a generic 500. Low frequency, but it's the concurrency edge case you flagged. **Fix:** `INSERT … ON CONFLICT (phone_hmac) DO UPDATE SET phone_hmac=EXCLUDED.phone_hmac RETURNING *` to make it idempotent.

---

## What's already done well (verified, not assumed)

- **SQLi:** every query is parameterized (`$1,$2…`); no string interpolation into SQL anywhere. ✔
- **XSS:** frontend renders user data via `textContent` (11 sites) or explicit `<`-escaping at the 4 `innerHTML` sinks (`esc()` in admin.html, inline replace in owner.html/scan.js). Server-side `moderateFreeText` strips markup/URLs/phones/emails before storage. CSP set (though `script-src 'unsafe-inline'` — acknowledged debt; escaping is the real guard). ✔ (tighten CSP when inline scripts are externalized)
- **CORS:** no `Access-Control-Allow-Origin` is set anywhere → same-origin only by default. Correctly locked down. ✔
- **Secrets:** none hardcoded; all from env; `.env` in `.gitignore`; `render.yaml` uses `generateValue`/`sync:false`. ✔ (see C1 for the guard bug)
- **Crypto:** AES-256-GCM (authenticated) for fields, keyed HMAC for lookups, `timingSafeEqual` for token/webhook signature checks, CSPRNG for tag/session IDs. ✔ (except OTP — C2)
- **Auth boundaries:** owner routes gated by `requireOwner`; observer routes by signed httpOnly/SameSite=strict/secure cookie; Twilio webhooks verify `X-Twilio-Signature`. ✔
- **Error handling:** central handler returns generic `internal` on 500, logs detail server-side, deliberately avoids PII (`notify.js` never logs plaintext; SMS-failure log prints the platform sender, not the user). ✔
- **Price integrity:** order amount computed server-side (`qty * PRICE_CENTS`), never trusted from the client. ✔
- **Data validation:** `asPhone` normalizer + E.164 regex, tag-ID regex, order field checks, qty bounds mirrored by a DB `CHECK`. ✔
- **Caching / N+1:** 30s Redis tag-state cache on the hot scan path; indexes on the join/expiry columns (`001`, `004`); no N+1 loops (owner dashboard aggregates messages via a single `json_agg` subquery). ✔
- **Supply chain:** `package-lock.json` committed, `npm ci`, Node ≥20 pinned, Dependabot configured, CI runs `node --check` + self-checks. ✔
- **Retention:** `cleanup.js` enforces the TTL table hourly (messages 72h/7d, sessions on expiry, abuse_reports 30d). ✔

---

## Minor / nice-to-have
- `express.urlencoded` has no `limit` (defaults 100kb); set it to match the 32kb JSON cap.
- `/api/inbox?token=` puts the inbox token in the query string (log exposure, lower sev than W5).
- `/admin/orders/:id/print` and `PATCH` with a non-numeric id return 500 (pg cast error) instead of 404 — cosmetic.
- No route/integration tests — only crypto/moderation self-checks. Add a couple of supertest-level checks for the activate→scan→message flow before you iterate further.
- 30-day owner tokens can't be revoked (no session store); acceptable for this app, but note it. Deleting the account effectively invalidates them (owner_id stops resolving).

---

## Ready-for-Prod Checklist

**Blockers (Critical): — ALL FIXED 2026-07-08**
- [x] C1 — Env guard fixed (prod ignores dev fallbacks) + boot-time assertion rejects the dev keys. Verified by a subprocess self-check.
- [x] C2 — OTP now `crypto.randomInt(100000, 1000000)`.
- [x] C3 — `/healthz` probes Postgres + Redis (503 on failure); added static `/livez` for liveness.

**Strongly recommended before public launch (Warnings): — ALL FIXED**
- [x] W1 — `hit()` fails open on Redis error for the scan path (`checkScanLimits`); write-path limits still fail closed.
- [x] W2 — Turnstile fails closed once configured + loud prod warning when unset; `/call` now has a per-destination-number cooldown (3/h, keyed on HMAC).
- [x] W3 — `schema_migrations` ledger (each file runs once) + `CREATE INDEX CONCURRENTLY` on the post-launch indexes (003, 004); comment-stripping splitter verified against all migrations.
- [x] W4 — Erasure now deletes `relay_sessions`/`messages` for the owner's tags (messages cascade); abuse_reports documented as legal hold.
- [x] W5 — Admin auth via `Authorization: Bearer` (timing-safe) with `?key=` fallback only for browser-opened pages; `no-store` on admin responses; `mint`/`reset-limits` moved to POST; admin.html updated.
- [x] W6 — Owner insert on activation is now `ON CONFLICT (phone_hmac) DO UPDATE … RETURNING *` (idempotent under concurrent first activation).

**Minor: — FIXED**
- [x] `urlencoded` body limit set to 32kb; non-numeric admin `:id` returns 404 (not a pg-cast 500); PATCH status returns 404 when no row matched.

**Environment / infra (verify at deploy):**
- [ ] All secrets set in Render env (not relying on generated defaults for the DB/Redis URLs).
- [ ] `BASE_URL` points at the real custom domain (drives QR links **and** Twilio webhook signature verification — a stale value silently breaks masked calls).
- [ ] Upgrade off Render **free** Postgres (deleted after 30 days) and free web (sleeps after 15 min idle) before real traffic.
- [ ] `TURNSTILE_SECRET` populated (empty = captcha disabled).
- [ ] Impressum / Datenschutz / AGB pages filled in (currently placeholders — legally required in DE).

**Rollback plan (Render):**
1. **Fastest revert:** Render dashboard → service → **Deploys** → pick the last green deploy → **Rollback**. ~2–3 min; redeploys the previous image, no code change needed.
2. **Via Git:** `git revert <bad-sha>` (or reset the `main` branch to the last good tag) → push → Render auto-redeploys. Prefer `revert` over force-push so history stays intact.
3. **Migrations:** all current migrations are additive and idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), so a code rollback does **not** require a schema rollback — the old code runs fine against the newer schema. Keep it that way: never ship a migration that drops/renames a column in the same deploy as the code that stops using it (expand-then-contract across two deploys).
4. **Tag each release** (`git tag prod-YYYYMMDD`) so "the last stable build" is unambiguous under pressure.
5. **Kill switch:** every owner has a per-tag `pause`, and unsetting `TWILIO_*` / `WA_*` env vars cleanly disables outbound relay (the code already degrades to no-op) if a relay provider misbehaves post-launch.
