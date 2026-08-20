BEGIN;

UPDATE categories
SET sort_order = 0
WHERE slug = 'accessories';

INSERT INTO schema_migrations(version)
VALUES ('065_prioritize_accessories_category')
ON CONFLICT(version) DO NOTHING;

COMMIT;
