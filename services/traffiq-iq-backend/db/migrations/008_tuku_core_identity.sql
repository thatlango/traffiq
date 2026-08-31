ALTER TABLE users ADD COLUMN IF NOT EXISTS core_user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_core_user_id_unique ON users(core_user_id) WHERE core_user_id IS NOT NULL;
