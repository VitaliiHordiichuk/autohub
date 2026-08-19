BEGIN;

CREATE SEQUENCE IF NOT EXISTS customer_number_seq
  START WITH 1358
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_number VARCHAR(11);

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at, id) + 1357 AS number_value
  FROM customers
  WHERE customer_number IS NULL
)
UPDATE customers AS customer
SET customer_number =
  'MAKA-' || LPAD(numbered.number_value::TEXT, 6, '0')
FROM numbered
WHERE customer.id = numbered.id;

SELECT setval(
  'customer_number_seq',
  GREATEST(
    1358,
    COALESCE(
      (
        SELECT MAX(SUBSTRING(customer_number FROM 6)::BIGINT)
        FROM customers
        WHERE customer_number ~ '^MAKA-[0-9]{6}$'
      ),
      1357
    )
  ),
  EXISTS(SELECT 1 FROM customers)
);

CREATE OR REPLACE FUNCTION allocate_customer_number()
RETURNS VARCHAR(11)
LANGUAGE plpgsql
AS $$
DECLARE
  sequence_value BIGINT;
  candidate VARCHAR(11);
BEGIN
  LOOP
    sequence_value := nextval('customer_number_seq');

    IF sequence_value > 999999 THEN
      RAISE EXCEPTION 'Customer number range is exhausted';
    END IF;

    candidate := 'MAKA-' || LPAD(sequence_value::TEXT, 6, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM customers
      WHERE customer_number = candidate
    );
  END LOOP;

  RETURN candidate;
END;
$$;

ALTER TABLE customers
  ALTER COLUMN customer_number SET DEFAULT allocate_customer_number(),
  ALTER COLUMN customer_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_number_unique
  ON customers(customer_number);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_customer_number_format_check'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_customer_number_format_check
      CHECK (customer_number ~ '^MAKA-[0-9]{6}$');
  END IF;
END;
$$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staff_number VARCHAR(20);

UPDATE users
SET staff_number = '777'
WHERE id = (
  SELECT u.id
  FROM users u
  JOIN roles r ON r.id = u.role_id
  WHERE r.name = 'ADMIN'
  ORDER BY u.created_at, u.id
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM users WHERE staff_number = '777'
);

CREATE UNIQUE INDEX IF NOT EXISTS users_staff_number_unique
  ON users(staff_number)
  WHERE staff_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  used_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_active_idx
  ON password_reset_tokens(user_id, expires_at DESC)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id BIGSERIAL PRIMARY KEY,
  identifier_hash CHAR(64) NOT NULL,
  ip_hash CHAR(64),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS password_reset_requests_identifier_idx
  ON password_reset_requests(identifier_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_requests_ip_idx
  ON password_reset_requests(ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

ALTER TABLE customer_history
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS ip_hash CHAR(64);

CREATE INDEX IF NOT EXISTS customer_history_created_idx
  ON customer_history(customer_id, created_at DESC, id DESC);

GRANT USAGE, SELECT ON SEQUENCE customer_number_seq TO autohub_app;
GRANT EXECUTE ON FUNCTION allocate_customer_number() TO autohub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO autohub_app;
GRANT USAGE, SELECT ON SEQUENCE password_reset_tokens_id_seq TO autohub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_requests TO autohub_app;
GRANT USAGE, SELECT ON SEQUENCE password_reset_requests_id_seq TO autohub_app;
GRANT SELECT, INSERT, UPDATE ON customer_history TO autohub_app;
GRANT SELECT, INSERT, UPDATE ON customers TO autohub_app;
GRANT SELECT, INSERT, UPDATE ON users TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('063_customer_account_security')
ON CONFLICT(version) DO NOTHING;

COMMIT;
