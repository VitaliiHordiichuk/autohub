BEGIN;

CREATE TABLE IF NOT EXISTS manager_permissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code VARCHAR(80) NOT NULL,
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, permission_code)
);

CREATE INDEX IF NOT EXISTS manager_permissions_user_id_idx
  ON manager_permissions(user_id);

INSERT INTO schema_migrations(version)
VALUES ('037_add_manager_permissions')
ON CONFLICT(version) DO NOTHING;

COMMIT;
