-- Hot-path indexes (scan lookup joins, session expiry sweeps).
-- CONCURRENTLY so building them on a populated table never blocks writes during deploy.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tags_vehicle ON tags (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_tag_expiry ON relay_sessions (tag_id, expires_at);
