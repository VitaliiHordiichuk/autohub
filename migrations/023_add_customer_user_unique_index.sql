BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS
  customers_user_id_unique
ON customers (user_id)
WHERE user_id IS NOT NULL;

COMMIT;
