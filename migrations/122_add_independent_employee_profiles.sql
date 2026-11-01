BEGIN;

-- Employee membership is independent from users and customers. A removed
-- employee remains here for audit and may be re-hired without a new user.
CREATE TABLE IF NOT EXISTS employee_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  staff_role VARCHAR(16) NOT NULL CHECK (staff_role IN ('ADMIN', 'MANAGER')),
  access_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  order_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  staff_auth_version INTEGER NOT NULL DEFAULT 0 CHECK (staff_auth_version >= 0),
  removed_at TIMESTAMP WITHOUT TIME ZONE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT employee_telegram_requires_access CHECK (NOT telegram_allowed OR access_enabled),
  CONSTRAINT employee_order_notifications_require_telegram CHECK (
    NOT order_notifications_enabled OR (telegram_allowed AND access_enabled)
  ),
  CONSTRAINT removed_employee_has_no_access CHECK (
    removed_at IS NULL OR (NOT access_enabled AND NOT telegram_allowed AND NOT order_notifications_enabled)
  )
);

CREATE INDEX IF NOT EXISTS employee_profiles_active_role_idx
  ON employee_profiles (staff_role, access_enabled)
  WHERE removed_at IS NULL;

-- Preserve existing staff access and Telegram behaviour. In particular,
-- existing manager user 6 is included without creating a customer row.
INSERT INTO employee_profiles (
  user_id, staff_role, access_enabled, telegram_allowed,
  order_notifications_enabled
)
SELECT u.id, r.name, u.is_active, u.is_active, u.is_active
FROM users u JOIN roles r ON r.id = u.role_id
WHERE r.name IN ('ADMIN', 'MANAGER')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO schema_migrations(version)
VALUES ('122_add_independent_employee_profiles')
ON CONFLICT (version) DO NOTHING;

COMMIT;
