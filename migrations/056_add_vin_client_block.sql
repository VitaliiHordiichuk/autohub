ALTER TABLE users
  ADD COLUMN IF NOT EXISTS vin_chat_blocked_at TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS vin_chat_blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vin_chat_block_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_vin_chat_blocked
  ON users(vin_chat_blocked_at)
  WHERE vin_chat_blocked_at IS NOT NULL;

GRANT UPDATE (vin_chat_blocked_at, vin_chat_blocked_by, vin_chat_block_reason)
  ON users TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('056_add_vin_client_block')
ON CONFLICT (version) DO NOTHING;
