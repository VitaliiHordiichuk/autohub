BEGIN;

-- Preserve attachment deduplication independently of disposable import reports.
ALTER TABLE email_import_files
  ADD COLUMN IF NOT EXISTS has_successful_import BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE email_import_files e
SET has_successful_import = TRUE
FROM imports i
WHERE e.import_id = i.id AND e.status = 'COMPLETED'
  AND i.status IN ('COMPLETED', 'COMPLETED_WITH_ERRORS') AND i.success_rows > 0;

-- One overwritten checkpoint, not another ever-growing maintenance history.
CREATE TABLE IF NOT EXISTS data_retention_state (
  job_name TEXT PRIMARY KEY,
  last_attempt_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_imports_retention_profile
  ON imports (warehouse_id, warehouse_supplier_import_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_email_import_files_import_id ON email_import_files (import_id);
CREATE INDEX IF NOT EXISTS idx_import_new_products_latest_row ON import_new_products (latest_import_row_id);
CREATE INDEX IF NOT EXISTS idx_import_new_products_first_import ON import_new_products (first_import_id);
CREATE INDEX IF NOT EXISTS idx_import_new_products_latest_import ON import_new_products (latest_import_id);
CREATE INDEX IF NOT EXISTS idx_notifications_retention_created ON user_notifications (created_at);
CREATE INDEX IF NOT EXISTS idx_customer_history_retention ON customer_history (type, created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_retention ON password_reset_requests (created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_retention ON password_reset_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_guest_carts_retention ON carts (updated_at) WHERE user_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autohub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON data_retention_state TO autohub_app;
    GRANT DELETE ON imports, import_rows, search_events, search_event_results,
      price_history, user_notifications, customer_history, password_reset_requests,
      password_reset_tokens, telegram_link_tokens, checkout_sessions,
      stock_reservations, carts, cart_items TO autohub_app;
  END IF;
END $$;

INSERT INTO schema_migrations(version) VALUES ('077_add_automatic_data_retention')
ON CONFLICT (version) DO NOTHING;
COMMIT;
