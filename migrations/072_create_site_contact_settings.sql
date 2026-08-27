BEGIN;

CREATE TABLE IF NOT EXISTS site_contact_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  phone_e164 VARCHAR(16),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT site_contact_phone_format CHECK (
    phone_e164 IS NULL OR phone_e164 ~ '^\+380[0-9]{9}$'
  )
);

INSERT INTO site_contact_settings(id, phone_e164)
VALUES (1, NULL)
ON CONFLICT(id) DO NOTHING;

INSERT INTO schema_migrations(version)
VALUES ('072_create_site_contact_settings')
ON CONFLICT(version) DO NOTHING;

COMMIT;
