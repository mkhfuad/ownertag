-- Card payments via Stripe Checkout (one-time). Order row is created first,
-- the webhook flips it to 'paid'; stripe_session_id makes that idempotent.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_check CHECK (payment IN ('rechnung','vorkasse','karte'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
