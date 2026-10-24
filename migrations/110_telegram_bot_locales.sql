-- Separate per-private-chat language preference for MAKAtron; never stores a token.
CREATE TABLE IF NOT EXISTS telegram_bot_locales (
  chat_id BIGINT PRIMARY KEY,
  locale VARCHAR(2) NOT NULL DEFAULT 'uk'
    CHECK (locale IN ('uk', 'en')),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations(version)
VALUES ('110_telegram_bot_locales')
ON CONFLICT (version) DO NOTHING;
