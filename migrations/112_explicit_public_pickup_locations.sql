BEGIN;

-- Internal warehouses and public customer pickup points are different concepts.
-- Nothing is made public by default, including OWN warehouses.
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS public_pickup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_pickup_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS public_pickup_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS public_pickup_address VARCHAR(250);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='warehouses_public_pickup_details_check'
      AND conrelid='public.warehouses'::regclass
  ) THEN
    ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_public_pickup_details_check
    CHECK (
      public_pickup_enabled IS NOT TRUE
      OR (
        is_active=TRUE
        AND pickup_available=TRUE
        AND NULLIF(BTRIM(public_pickup_name),'') IS NOT NULL
        AND NULLIF(BTRIM(public_pickup_city),'') IS NOT NULL
        AND NULLIF(BTRIM(public_pickup_address),'') IS NOT NULL
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_warehouses_public_pickup
  ON public.warehouses(public_pickup_enabled, is_active)
  WHERE public_pickup_enabled = TRUE;

INSERT INTO schema_migrations(version)
VALUES('112_explicit_public_pickup_locations')
ON CONFLICT(version) DO NOTHING;

COMMIT;
