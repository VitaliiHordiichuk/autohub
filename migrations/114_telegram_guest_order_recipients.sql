BEGIN;

-- Guests ordering from MAKAtron have no website account. Persist the
-- Telegram destination separately from replaceable 7-day order drafts, so
-- confirmation by a manager still reaches a guest who has started a new cart.
CREATE TABLE IF NOT EXISTS public.telegram_guest_order_recipients (
  order_id INTEGER PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  confirmed_claimed_until TIMESTAMP NULL,
  confirmed_notified_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_telegram_guest_order_recipient_chat
  ON public.telegram_guest_order_recipients(telegram_chat_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.telegram_guest_order_recipients TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('114_telegram_guest_order_recipients')
ON CONFLICT(version) DO NOTHING;

COMMIT;
