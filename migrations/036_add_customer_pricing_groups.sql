BEGIN;

ALTER TABLE price_groups
  ADD COLUMN IF NOT EXISTS pricing_mode VARCHAR(20) NOT NULL DEFAULT 'DISCOUNT';
ALTER TABLE price_groups DROP CONSTRAINT IF EXISTS price_groups_pricing_mode_check;
ALTER TABLE price_groups ADD CONSTRAINT price_groups_pricing_mode_check
  CHECK (pricing_mode IN ('DISCOUNT', 'MINIMUM'));

INSERT INTO price_groups(name, discount_percent, pricing_mode)
SELECT 'Wholesale', 25, 'DISCOUNT'
WHERE NOT EXISTS (SELECT 1 FROM price_groups WHERE LOWER(name) = 'wholesale');
INSERT INTO price_groups(name, discount_percent, pricing_mode)
SELECT 'Wholesale+', 30, 'DISCOUNT'
WHERE NOT EXISTS (SELECT 1 FROM price_groups WHERE LOWER(name) = 'wholesale+');
INSERT INTO price_groups(name, discount_percent, pricing_mode)
SELECT 'VIP', 0, 'MINIMUM'
WHERE NOT EXISTS (SELECT 1 FROM price_groups WHERE LOWER(name) = 'vip');

UPDATE price_groups
SET discount_percent = 0,
    pricing_mode = 'MINIMUM'
WHERE LOWER(name) = 'vip';

INSERT INTO schema_migrations(version) VALUES ('036_add_customer_pricing_groups')
ON CONFLICT(version) DO NOTHING;
COMMIT;
