BEGIN;

DO $$
BEGIN
  IF to_regclass('public.warehouse_import_settings') IS NULL
    OR to_regclass('public.price_history') IS NULL
    OR to_regclass('public.supplier_import_settings') IS NULL
    OR to_regclass('public.warehouse_supplier_imports') IS NULL
    OR to_regclass('public.user_delivery_profiles') IS NULL
    OR to_regclass('public.order_delivery_details') IS NULL
  THEN
    RAISE EXCEPTION 'Legacy migration schema 013-024 is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'carts'
      AND column_name = 'guest_token_hash'
  ) THEN
    RAISE EXCEPTION 'Legacy migration 024 is incomplete';
  END IF;

  IF to_regclass('public.customers_user_id_unique') IS NULL
    OR to_regclass('public.carts_guest_token_hash_unique') IS NULL
  THEN
    RAISE EXCEPTION 'Legacy migration indexes 023-024 are incomplete';
  END IF;
END $$;

INSERT INTO schema_migrations (version)
VALUES
  ('013_extend_import_rows'),
  ('014_create_warehouse_import_settings'),
  ('015_add_start_row_to_import_settings'),
  ('016_create_price_history'),
  ('017_add_change_percent_to_price_history'),
  ('018_create_supplier_import_settings'),
  ('019_create_warehouse_supplier_imports'),
  ('020_extend_imports'),
  ('021_extend_import_rows'),
  ('022_create_delivery_profiles'),
  ('023_add_customer_user_unique_index'),
  ('024_add_guest_cart_token'),
  ('042_reconcile_legacy_migration_history')
ON CONFLICT (version) DO NOTHING;

COMMIT;
