BEGIN;

-- Staff-only true incoming cost, intentionally NOT part of product_offers:
-- public SELECT po.* and all price engines remain unchanged.
CREATE TABLE IF NOT EXISTS public.product_offer_internal_costs (
  product_offer_id INTEGER PRIMARY KEY
    REFERENCES public.product_offers(id) ON DELETE CASCADE,
  unit_cost NUMERIC(16,6) NOT NULL
    CHECK (unit_cost > 0 AND unit_cost < 100000000),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Opt-in per WAREHOUSE import, not per shared supplier definition.
ALTER TABLE public.warehouse_supplier_imports
  ADD COLUMN IF NOT EXISTS internal_purchase_price_column INTEGER
  CHECK (internal_purchase_price_column BETWEEN 1 AND 100);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.product_offer_internal_costs TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES('116_add_private_offer_cost_import')
ON CONFLICT(version) DO NOTHING;

COMMIT;
