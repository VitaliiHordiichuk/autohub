BEGIN;

-- Existing Telegram drafts remain valid. These additional checkout stages are
-- needed for profile-based contact confirmation and optional customer notes.
ALTER TABLE public.telegram_order_drafts
  DROP CONSTRAINT IF EXISTS telegram_order_draft_stage_check;

ALTER TABLE public.telegram_order_drafts
  ADD CONSTRAINT telegram_order_draft_stage_check CHECK (
    stage IN (
      'EDIT','DELIVERY','PICKUP','CITY_INPUT','CITY_CHOICE',
      'POINT_INPUT','POINT_CHOICE','CONTACT_INPUT','CONTACT_CONFIRM',
      'COMMENT_CHOICE','COMMENT_INPUT','REVIEW','PROCESSING','DONE'
    )
  );

INSERT INTO schema_migrations(version)
VALUES ('113_telegram_profile_and_optional_comment_stages')
ON CONFLICT (version) DO NOTHING;

COMMIT;
