-- Incident model + smart routing: category & lifecycle status on relay sessions,
-- and an optional emergency contact on the owner (encrypted like all PII).
ALTER TABLE relay_sessions ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE relay_sessions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE owners ADD COLUMN IF NOT EXISTS emergency_enc TEXT;
