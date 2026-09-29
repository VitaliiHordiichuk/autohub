MAKA RETURN POLICY ROLLOUT AND ROLLBACK

DEPLOY
1. Apply migration 086_add_return_policy_overrides.
2. Deploy the new backend.
3. Deploy the new frontend.

NORMAL OPERATION
- products/warehouses/product_offers.return_policy_override are the source of truth.
- Legacy boolean columns are compatibility fields only.

ROLLBACK TO A BACKEND THAT DOES NOT UNDERSTAND PRODUCT OVERRIDES
1. Stop return-policy edits in admin.
2. Run the dry run against the target database:
     npm run sync:return-policy-legacy
3. Review Before, Would change and After (projected) counts.
4. Apply the reconciliation:
     npm run sync:return-policy-legacy -- --apply
5. Verify the committed After counts.
6. Only then restart the old backend/frontend.

Do not start the old backend after product-level overrides have been used unless
the reconciliation was applied. The old backend cannot read product overrides.

RE-UPGRADE AFTER AN OLD BACKEND ROLLBACK
Recommended procedure: keep return settings read-only while the old backend is
running, then redeploy the new backend without modifying the new override fields.

If administrators changed legacy return settings during the rollback window, the
new override fields may be stale. Do not rerun migration 086 as a reconciliation:
its backfill intentionally does not overwrite existing new values. Before a new
upgrade, build and run an explicit legacy-to-new reconciliation reviewed for the
desired precedence and business meaning.
