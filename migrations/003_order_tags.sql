-- Link minted tags to the order they were produced for (idempotent fulfillment)
ALTER TABLE tags ADD COLUMN IF NOT EXISTS order_id BIGINT;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tags_order ON tags (order_id) WHERE order_id IS NOT NULL;
