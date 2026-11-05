-- Registration started inside MAKAtron can prove the Telegram sender and
-- link the new website account without a second Telegram linking step.
-- Tokens are short-lived, one-time, hashed, and never accepted as a site login.
BEGIN;
CREATE TABLE IF NOT EXISTS telegram_registration_claims (
  telegram_user_id BIGINT PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username VARCHAR(120),
  telegram_first_name VARCHAR(160),
  preferred_locale VARCHAR(5) NOT NULL DEFAULT 'uk',
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  used_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT telegram_registration_claim_private_chat_check
    CHECK (telegram_chat_id = telegram_user_id),
  CONSTRAINT telegram_registration_claim_locale_check
    CHECK (preferred_locale IN ('uk', 'en'))
);
CREATE INDEX IF NOT EXISTS idx_telegram_registration_claims_expiration
  ON telegram_registration_claims (expires_at);
-- Production API and MAKAtron workers use this application role, not postgres.
-- Match the privileges of existing Telegram link tables.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON telegram_registration_claims TO autohub_app;
INSERT INTO schema_migrations(version)
VALUES ('126_makatron_registration_identity')
ON CONFLICT (version) DO NOTHING;
COMMIT;
