ALTER TABLE vin_requests
  ADD COLUMN IF NOT EXISTS guest_name VARCHAR(120);

ALTER TABLE vin_requests
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vin_requests_requester_check'
      AND conrelid = 'vin_requests'::regclass
  ) THEN
    ALTER TABLE vin_requests
      ADD CONSTRAINT vin_requests_requester_check
      CHECK (
        user_id IS NOT NULL
        OR NULLIF(BTRIM(contact_phone), '') IS NOT NULL
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE vin_requests
  VALIDATE CONSTRAINT vin_requests_requester_check;

CREATE INDEX IF NOT EXISTS idx_vin_requests_guest_phone_recent
  ON vin_requests(contact_phone, created_at DESC)
  WHERE user_id IS NULL;

INSERT INTO schema_migrations(version)
VALUES ('078_add_guest_vin_requests')
ON CONFLICT (version) DO NOTHING;
