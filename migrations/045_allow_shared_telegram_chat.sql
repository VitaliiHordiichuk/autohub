ALTER TABLE user_telegram_connections
  DROP CONSTRAINT IF EXISTS user_telegram_connections_telegram_chat_id_key;

CREATE INDEX IF NOT EXISTS idx_user_telegram_connections_chat
  ON user_telegram_connections(telegram_chat_id);

INSERT INTO schema_migrations(version)
VALUES ('045_allow_shared_telegram_chat')
ON CONFLICT (version) DO NOTHING;
