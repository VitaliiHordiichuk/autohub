ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS phone_verified_value VARCHAR(30);

ALTER TABLE user_telegram_connections
  ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_user_telegram_connections_telegram_user
  ON user_telegram_connections(telegram_chat_id, telegram_user_id);

GRANT UPDATE (phone_verified_at, phone_verified_value) ON users TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('055_add_phone_verification')
ON CONFLICT (version) DO NOTHING;
