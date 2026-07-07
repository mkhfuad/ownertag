-- Shop orders. Contact/shipping data encrypted at rest like everything else.
CREATE TABLE IF NOT EXISTS orders (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  email_enc    TEXT NOT NULL,
  phone_enc    TEXT,
  address_enc  TEXT NOT NULL,
  qty          INT NOT NULL CHECK (qty BETWEEN 1 AND 20),
  amount_cents INT NOT NULL,
  payment      TEXT NOT NULL DEFAULT 'rechnung' CHECK (payment IN ('rechnung','vorkasse')),
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','paid','shipped','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
