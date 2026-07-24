BEGIN;

ALTER TABLE carts
ADD COLUMN IF NOT EXISTS guest_token_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS
  carts_guest_token_hash_unique
ON carts (guest_token_hash)
WHERE guest_token_hash IS NOT NULL;

COMMIT;
