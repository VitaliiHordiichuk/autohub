ALTER TABLE products
  ADD COLUMN IF NOT EXISTS return_policy_override VARCHAR(20) NOT NULL DEFAULT 'INHERIT',
  ADD COLUMN IF NOT EXISTS return_policy_note TEXT;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS return_policy_override VARCHAR(20),
  ADD COLUMN IF NOT EXISTS return_policy_note TEXT;

UPDATE warehouses
SET return_policy_override = CASE
  WHEN returnable_by_default = FALSE THEN 'NON_RETURNABLE'
  ELSE 'RETURNABLE'
END
WHERE return_policy_override IS NULL;

ALTER TABLE warehouses
  ALTER COLUMN return_policy_override SET DEFAULT 'INHERIT',
  ALTER COLUMN return_policy_override SET NOT NULL;

ALTER TABLE product_offers
  ADD COLUMN IF NOT EXISTS return_policy_override VARCHAR(20),
  ADD COLUMN IF NOT EXISTS return_policy_note TEXT;

UPDATE product_offers
SET return_policy_override = CASE
  WHEN is_returnable = TRUE THEN 'RETURNABLE'
  WHEN is_returnable = FALSE THEN 'NON_RETURNABLE'
  ELSE 'INHERIT'
END
WHERE return_policy_override IS NULL;

ALTER TABLE product_offers
  ALTER COLUMN return_policy_override SET DEFAULT 'INHERIT',
  ALTER COLUMN return_policy_override SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_return_policy_override_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_return_policy_override_check
      CHECK (return_policy_override IN ('INHERIT', 'RETURNABLE', 'NON_RETURNABLE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'warehouses_return_policy_override_check'
  ) THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_return_policy_override_check
      CHECK (return_policy_override IN ('INHERIT', 'RETURNABLE', 'NON_RETURNABLE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_offers_return_policy_override_check'
  ) THEN
    ALTER TABLE product_offers ADD CONSTRAINT product_offers_return_policy_override_check
      CHECK (return_policy_override IN ('INHERIT', 'RETURNABLE', 'NON_RETURNABLE'));
  END IF;
END $$;

INSERT INTO schema_migrations(version)
VALUES ('086_add_return_policy_overrides')
ON CONFLICT (version) DO NOTHING;
