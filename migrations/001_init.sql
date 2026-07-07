-- OwnerTag schema v1 — matches ownertag-germany-solution.md §3.2
CREATE TABLE IF NOT EXISTS owners (
  id           BIGSERIAL PRIMARY KEY,
  phone_enc    TEXT NOT NULL,            -- AES-256-GCM, see src/crypto.js
  phone_hmac   TEXT NOT NULL UNIQUE,     -- keyed HMAC for dedup lookup, never plaintext
  email_enc    TEXT,
  locale       TEXT NOT NULL DEFAULT 'de',
  prefs_json   JSONB NOT NULL DEFAULT '{"channels":["whatsapp","email","sms"],"calls":true,"quiet":null}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id           BIGSERIAL PRIMARY KEY,
  owner_id     BIGINT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  plate_enc    TEXT,                     -- personal data under German case law: encrypted
  type         TEXT NOT NULL DEFAULT 'car'
);

CREATE TABLE IF NOT EXISTS tags (
  tag_id       TEXT PRIMARY KEY,         -- 10-char Crockford base32
  state        TEXT NOT NULL DEFAULT 'unactivated'
               CHECK (state IN ('unactivated','active','paused')),
  vehicle_id   BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
  muted_until  TIMESTAMPTZ,
  activated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS relay_sessions (
  session_id            TEXT PRIMARY KEY,
  tag_id                TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
  observer_endpoint_enc TEXT,            -- optional masked callback (phone), encrypted
  channel               TEXT,
  state                 TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','blocked')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE TABLE IF NOT EXISTS messages (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES relay_sessions(session_id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('to_owner','to_observer')),
  body          TEXT NOT NULL,
  moderation    TEXT NOT NULL DEFAULT 'passed',
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,          -- frozen copy, survives normal TTL purge (30 d hold)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON relay_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles (owner_id);
