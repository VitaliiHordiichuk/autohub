BEGIN;

SET LOCAL lock_timeout = '5s';

-- Preserve every existing merchandising position. Rotation is explicitly opt-in.
ALTER TABLE homepage_product_features
  ADD COLUMN IF NOT EXISTS is_position_fixed BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN homepage_product_features.is_position_fixed IS
  'Keep the slot from sort_order/id; false rotates daily within unpinned slots of the same feature_type.';

INSERT INTO schema_migrations(version)
VALUES ('132_homepage_feature_daily_rotation')
ON CONFLICT(version) DO NOTHING;

COMMIT;
