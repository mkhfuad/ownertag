-- Hot-path indexes (scan lookup joins, session expiry sweeps)
CREATE INDEX IF NOT EXISTS idx_tags_vehicle ON tags (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_tag_expiry ON relay_sessions (tag_id, expires_at);
