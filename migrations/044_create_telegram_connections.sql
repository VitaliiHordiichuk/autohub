CREATE TABLE IF NOT EXISTS user_telegram_connections (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  telegram_username VARCHAR(120),
  telegram_first_name VARCHAR(160),
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  linked_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  used_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_active
  ON telegram_link_tokens(token_hash, expires_at)
  WHERE used_at IS NULL;

INSERT INTO schema_migrations(version)
VALUES ('044_create_telegram_connections')
ON CONFLICT (version) DO NOTHING;
