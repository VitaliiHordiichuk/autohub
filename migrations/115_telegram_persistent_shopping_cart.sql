BEGIN;

-- The customer cart survives new searches and restarts. It is separate from
-- short-lived Telegram checkout drafts and from the website shopping cart.
CREATE TABLE IF NOT EXISTS public.telegram_shopping_carts (
  chat_id BIGINT PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT telegram_shopping_carts_items_array CHECK (jsonb_typeof(items)='array')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_shopping_carts TO autohub_app;

ALTER TABLE public.telegram_order_drafts
  DROP CONSTRAINT IF EXISTS telegram_order_draft_stage_check;
ALTER TABLE public.telegram_order_drafts
  ADD CONSTRAINT telegram_order_draft_stage_check CHECK (
    stage IN (
      'EDIT','SEARCH_INPUT','CART','CART_CLEAR_CONFIRM',
      'DELIVERY','PICKUP','CITY_INPUT','CITY_CHOICE',
      'POINT_INPUT','POINT_CHOICE','CONTACT_INPUT','CONTACT_CONFIRM',
      'COMMENT_CHOICE','COMMENT_INPUT','REVIEW','PROCESSING','DONE'
    )
  );

INSERT INTO schema_migrations(version)
VALUES('115_telegram_persistent_shopping_cart')
ON CONFLICT(version) DO NOTHING;

COMMIT;
