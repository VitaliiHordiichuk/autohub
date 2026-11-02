BEGIN;

-- Explicit MAKAtron staff pairing, separate from legacy Telegram client links.
CREATE TABLE IF NOT EXISTS public.makatron_staff_link_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.makatron_staff_links (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (telegram_chat_id = telegram_user_id),
  UNIQUE (telegram_chat_id, telegram_user_id)
);

-- Only orders created AFTER installation are initially queued to staff.
CREATE TABLE IF NOT EXISTS public.makatron_staff_order_cursor (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_order_id INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO public.makatron_staff_order_cursor(singleton,last_order_id)
SELECT TRUE,COALESCE(MAX(id),0) FROM public.orders
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.makatron_staff_order_deliveries (
  order_id INTEGER NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id,user_id)
);

GRANT SELECT,INSERT,UPDATE,DELETE
  ON public.makatron_staff_link_tokens,
  public.makatron_staff_links,
  public.makatron_staff_order_cursor,
  public.makatron_staff_order_deliveries TO autohub_app;
GRANT USAGE,SELECT ON SEQUENCE public.makatron_staff_link_tokens_id_seq TO autohub_app;

INSERT INTO public.schema_migrations(version)
VALUES ('117_makatron_staff_orders_quotes')
ON CONFLICT (version) DO NOTHING;
COMMIT;
