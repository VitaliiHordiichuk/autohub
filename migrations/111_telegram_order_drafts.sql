BEGIN;
-- MAKAtron holds a Telegram-only draft. This is not an order or a site cart.
CREATE TABLE IF NOT EXISTS telegram_order_drafts (
  chat_id BIGINT PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  session_key VARCHAR(24) NOT NULL,
  stage VARCHAR(32) NOT NULL DEFAULT 'EDIT',
  draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_id BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT telegram_order_draft_stage_check
    CHECK (stage IN ('EDIT','DELIVERY','PICKUP','CITY_INPUT','CITY_CHOICE',
      'POINT_INPUT','POINT_CHOICE','CONTACT_INPUT','REVIEW','PROCESSING','DONE'))
);
CREATE INDEX IF NOT EXISTS idx_telegram_order_drafts_updated
  ON telegram_order_drafts(updated_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_order_drafts TO autohub_app;
INSERT INTO schema_migrations(version) VALUES ('111_telegram_order_drafts')
ON CONFLICT (version) DO NOTHING;
COMMIT;
