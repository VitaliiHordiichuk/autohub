CREATE TABLE IF NOT EXISTS vin_request_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode VARCHAR(24) NOT NULL DEFAULT 'CHAT'
    CHECK (mode IN ('CHAT', 'DAILY_REQUEST', 'DISABLED')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO vin_request_settings(id, mode)
VALUES (1, 'CHAT')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE vin_request_recommendations
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS dismissed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

GRANT SELECT, UPDATE ON vin_request_settings TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('057_add_vin_request_modes_and_dismissals')
ON CONFLICT (version) DO NOTHING;
