# OwnerTag — Overhaul Plan (Phases 1–2)

## Verdict
Not a legacy rescue. ~1,300 LOC, security-conscious backend (AES-256-GCM field
encryption, CSPRNG tokens, keyed-HMAC lookups, timing-safe token compare, stdlib
signed tokens, careful rate limiting, GDPR-aware data flow, real `/healthz`, CI,
tests). The old `PRE-DEPLOY-AUDIT.md` criticals are already fixed. This is a
**hardening + modernization**, done incrementally, with the live app running throughout.

## Top 5 priorities
1. Choose modernization strategy → **in-place TypeScript + modern frontend** (keep Postgres/Redis/Render).
2. Type safety & validation — add TypeScript + Zod at every API boundary (today: none; validation is manual).
3. Frontend — static multi-page HTML + inline scripts → component framework (also removes CSP `'unsafe-inline'`).
4. Ops & observability — free Postgres is **deleted after 30 days** (fix infra); add structured logs + error tracking.
5. Integrations — consolidate the two Twilio paths onto the official SDK; add retries/timeouts to relays.

## Phase 1 — Audit findings

| Sev | Area | Finding |
|---|---|---|
| High | DevOps | Free Postgres deleted after 30 days; free services cold-start ~40s. Define backup/upgrade. |
| High | Types | No TypeScript; no schema validation library. |
| Med | UI/UX | 6 static HTML pages w/ inline scripts; no components/design system; forces CSP `'unsafe-inline'`. |
| Med | Integrations | Dual Twilio paths (REST + SDK); relays via raw fetch, no retry/timeout. |
| Med | Observability | `console.error` only; no structured logs/metrics/error aggregation. |
| Low | Structure | `routes.js` (390 lines) mixes auth/activation/messaging/sessions. |
| Low | Security | CSP `'unsafe-inline'` (documented tradeoff; user content escaped). |
| Low | Tests | Only `selfcheck.js`; no route/integration tests. |

**Already strong — leave alone:** crypto, rate-limiting, token scheme, GDPR flow, `/healthz`, CI, env guard.

## Phase 2 — Target structure (in-place TS + modern frontend, one Render service)

```
ownertag-app/
├─ src/                      # Express backend, JS → TS module-by-module (strangler)
│  ├─ server.ts  config.ts
│  ├─ modules/{auth,tags,relay,shop}/   # each: *.routes.ts *.service.ts *.schema.ts
│  ├─ lib/{crypto,db,redis,ratelimit,moderation,twilio}.ts
│  ├─ middleware/{error,security,requireOwner}.ts
│  └─ health/health.routes.ts           # /api/health (readiness) + /livez
├─ shared/contracts.ts       # Zod schemas → inferred types, shared with frontend
├─ web/                      # NEW: Vite + React + Tailwind + shadcn/ui
│  └─ src/{pages,components/ui,features,lib/api.ts,app.tsx}   # builds → src/public
├─ migrations/  test/(vitest)  .github/workflows/ci.yml
├─ Dockerfile (multi-stage)  render.yaml  tsconfig.json  .env.example  package.json
```

**Migration sequencing (zero-downtime):** convert `lib/` first (pure, tested) → one
`module/` at a time behind stable routes → frontend last, page by page. The app runs
on the mixed JS/TS build the entire time.

**Cutover note:** moving from `node src/server.js` to a TS build is one deliberate,
tested deploy (Dockerfile multi-stage: build web + compile TS → run `dist/`). Until
then, new `.ts` files are additive and don't affect the running app.
