-- Special-order TXT data are NOT products or public catalog offers.
-- Import a new revision alongside the active one. Only publish it by
-- atomically changing special_order_sources.active_import_id after validation.
-- Do not run this migration on production until the importer has passed tests.
BEGIN;

CREATE TABLE IF NOT EXISTS special_order_import_runs (
  id BIGSERIAL PRIMARY KEY,
  source_key VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IMPORTING'
    CHECK (status IN ('IMPORTING','READY','FAILED')),
  total_lines BIGINT NOT NULL DEFAULT 0 CHECK (total_lines >= 0),
  eligible_lines BIGINT NOT NULL DEFAULT 0 CHECK (eligible_lines >= 0),
  rejected_lines BIGINT NOT NULL DEFAULT 0 CHECK (rejected_lines >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS special_order_sources (
  source_key VARCHAR(64) PRIMARY KEY,
  active_import_id BIGINT REFERENCES special_order_import_runs(id)
);

CREATE TABLE IF NOT EXISTS special_order_entries (
  import_id BIGINT NOT NULL REFERENCES special_order_import_runs(id) ON DELETE CASCADE,
  line_number BIGINT NOT NULL CHECK (line_number > 0),
  article VARCHAR(120) NOT NULL,
  article_normalized VARCHAR(120) NOT NULL CHECK (length(article_normalized) > 0),
  title TEXT,
  discount_group VARCHAR(8) NOT NULL,
  retail_ex_vat_uah NUMERIC(14,4) NOT NULL CHECK (retail_ex_vat_uah > 0),
  PRIMARY KEY (import_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_special_order_entries_search
  ON special_order_entries (import_id, article_normalized, retail_ex_vat_uah);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  special_order_import_runs,
  special_order_sources,
  special_order_entries TO autohub_app;

GRANT USAGE, SELECT ON
  special_order_import_runs_id_seq TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('125_special_order_txt_fallback')
ON CONFLICT(version) DO NOTHING;

COMMIT;
