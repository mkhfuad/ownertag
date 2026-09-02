-- Records when the QR-code approval email was sent to a customer (admin badge).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qr_sent_at TIMESTAMPTZ;
