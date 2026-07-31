BEGIN;

UPDATE price_groups
SET
  name = 'Registered',
  discount_percent = 5,
  pricing_mode = 'DISCOUNT'
WHERE LOWER(name) = 'registered';

UPDATE price_groups
SET
  name = 'GOLD',
  discount_percent = 25,
  pricing_mode = 'DISCOUNT'
WHERE LOWER(name) = 'gold';

UPDATE price_groups
SET
  name = 'VIP',
  discount_percent = 0,
  pricing_mode = 'MINIMUM'
WHERE LOWER(name) = 'vip';

UPDATE customers AS c
SET price_group_id = gold.id
FROM price_groups AS current_group,
     price_groups AS gold
WHERE current_group.id = c.price_group_id
  AND LOWER(gold.name) = 'gold'
  AND LOWER(current_group.name) NOT IN ('registered', 'gold', 'vip');

DELETE FROM price_groups
WHERE LOWER(name) NOT IN ('registered', 'gold', 'vip');

INSERT INTO schema_migrations(version)
VALUES ('041_simplify_customer_price_groups')
ON CONFLICT(version) DO NOTHING;

COMMIT;
