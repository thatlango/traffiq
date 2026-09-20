ALTER TABLE users ADD COLUMN IF NOT EXISTS core_product_session text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS core_product_session_expires_at timestamptz;
