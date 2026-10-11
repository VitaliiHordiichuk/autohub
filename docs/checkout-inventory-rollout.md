# Checkout inventory rollout

Migration `105_add_commit_on_submit_checkout.sql` is additive. It does not
delete reservations or rewrite existing orders. The new path is disabled
unless `CHECKOUT_COMMIT_ON_SUBMIT_ENABLED=true` is set on the backend.

## Production preflight (read only)

Run only after explicit approval. The first query locates source-type drift;
the second inspects the reported article without changing data.

```sql
SELECT
  po.id AS offer_id,
  p.article,
  po.warehouse_id,
  w.name AS warehouse_name,
  w.type AS warehouse_type,
  po.supplier_id,
  s.name AS supplier_name,
  s.type AS supplier_type,
  po.source_type AS stored_source_type,
  CASE
    WHEN s.type = 'OWN' THEN 'OWN_STOCK'
    WHEN s.type = 'PARTNER' THEN 'SUPPLIER'
    WHEN w.type = 'OWN' THEN 'OWN_STOCK'
    WHEN w.type = 'SUPPLIER' THEN 'SUPPLIER'
    ELSE po.source_type
  END AS expected_source_type,
  po.quantity,
  po.is_available,
  po.is_hidden
FROM product_offers po
JOIN products p ON p.id = po.product_id
LEFT JOIN warehouses w ON w.id = po.warehouse_id
LEFT JOIN suppliers s ON s.id = COALESCE(po.supplier_id, w.supplier_id)
WHERE po.source_type IS DISTINCT FROM CASE
  WHEN s.type = 'OWN' THEN 'OWN_STOCK'
  WHEN s.type = 'PARTNER' THEN 'SUPPLIER'
  WHEN w.type = 'OWN' THEN 'OWN_STOCK'
  WHEN w.type = 'SUPPLIER' THEN 'SUPPLIER'
  ELSE po.source_type
END
ORDER BY p.article, po.id;

SELECT
  po.*, p.article, p.name,
  w.name AS warehouse_name, w.type AS warehouse_type,
  s.name AS supplier_name, s.type AS supplier_type
FROM product_offers po
JOIN products p ON p.id = po.product_id
LEFT JOIN warehouses w ON w.id = po.warehouse_id
LEFT JOIN suppliers s ON s.id = COALESCE(po.supplier_id, w.supplier_id)
WHERE p.article_normalized = 'B66961525'
FOR SHARE OF po;
```

Do not run a global update. After every conflicting offer has been reviewed,
repair only the approved IDs inside a transaction, with their expected
warehouse and supplier types in the `WHERE` clause. Verify the selected and
updated row counts before committing.

## Deployment order

1. Stop imports briefly and take a custom-format PostgreSQL backup plus a
   separate schema-only backup. Record application revisions and environment.
2. Apply migration 105 with the schema-owner role. Apply it a second time in
   staging to verify idempotency.
3. Deploy the dual-model backend with the feature flag absent/false.
4. Deploy the compatible frontend. It understands both legacy timed checkout
   and commit-on-submit responses.
5. Run legacy checkout, order confirmation, completion, cancellation and
   import smoke tests while the flag remains off.
6. Run the read-only source audit. Repair only individually approved rows.
7. Enable `CHECKOUT_COMMIT_ON_SUBMIT_ENABLED=true` on one backend instance,
   restart it and run guest, account, stock, supplier and mixed-cart smoke
   tests. Confirm `ORDER_COMMIT` movements and the absence of cart holds.
8. Enable the remaining instances only after the first instance is verified.
9. Monitor order counts, idempotency conflicts, checkout conflict codes,
   negative quantities, movement uniqueness and import deltas.

## Import model

Supplier offers remain external snapshots and are replaced absolutely. Own
stock imports keep `last_import_quantity` and apply only the change from the
previous imported snapshot to the current sellable quantity. Therefore a
repeated file cannot restore a unit committed by an order, while a higher
snapshot records a real receipt and a lower snapshot records a reduction.
Manager quantity changes remain deliberate physical adjustments.

## Rollback

Turning the flag off is the normal rollback for new checkout sessions. A
session already created as `COMMIT_ON_SUBMIT` continues through the new path,
because dispatch is based on its persisted inventory model. Existing new-model
orders also continue through the dual confirmation/completion/cancellation
services.

Do not roll the backend binary back to a revision that predates the dual-model
branches after any `COMMIT_ON_SUBMIT` order exists. That binary expects a
reservation and cannot safely process the new order. For an application
incident, keep or restore the dual-model backend, disable the flag and roll
back only the frontend if needed. A database restore is a disaster-recovery
operation, not a normal deploy rollback, because it would also discard valid
orders placed after the backup.

The additive columns and historical reservation tables remain in place during
rollback. Remove them only in a later, separately approved migration after all
legacy orders are terminal.
