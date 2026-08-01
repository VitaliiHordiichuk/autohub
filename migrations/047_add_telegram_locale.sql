ALTER TABLE telegram_link_tokens
  ADD COLUMN IF NOT EXISTS locale VARCHAR(5) NOT NULL DEFAULT 'uk';

ALTER TABLE user_telegram_connections
  ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(5) NOT NULL DEFAULT 'uk';

INSERT INTO schema_migrations(version)
VALUES ('047_add_telegram_locale')
ON CONFLICT (version) DO NOTHING;
