-- Recurring membership billing (Stripe). One-time shop `orders` stay as-is;
-- this governs the €24.99-then-€9.99/yr service subscription.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     BIGSERIAL PRIMARY KEY,
  owner_id               BIGINT REFERENCES owners(id) ON DELETE SET NULL,
  email_enc              TEXT,                         -- AES-256-GCM, matches the rest of the app
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,                  -- idempotency key for the webhook upsert
  status                 TEXT NOT NULL DEFAULT 'incomplete'
                         CHECK (status IN ('incomplete','active','past_due','canceled')),
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Premium (masked SMS/voice) is gated at request time by billingActive(), which
-- joins tag → vehicle → owner → subscription and checks status='active' live.
-- So a lapsed payment just blocks premium channels; the free web/email tier keeps
-- working and no tag rows are mutated. Owner-level, so no per-tag link is needed.
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subs_owner ON subscriptions (owner_id) WHERE owner_id IS NOT NULL;
