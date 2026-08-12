BEGIN;

ALTER TABLE user_delivery_profiles
  ADD COLUMN IF NOT EXISTS recipient_middle_name VARCHAR(100);

ALTER TABLE order_delivery_details
  ADD COLUMN IF NOT EXISTS recipient_middle_name VARCHAR(100);

COMMIT;
