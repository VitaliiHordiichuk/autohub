import { pool } from "../config/db.js";
import { RETURN_POLICY } from "./ReturnPolicyService.js";

export function legacyWarehouseReturnableByDefault(warehouseOverride) {
  return warehouseOverride !== RETURN_POLICY.NON_RETURNABLE;
}

export function legacyOfferIsReturnable({
  offerOverride = RETURN_POLICY.INHERIT,
  productOverride = RETURN_POLICY.INHERIT,
} = {}) {
  if (offerOverride === RETURN_POLICY.RETURNABLE) return true;
  if (offerOverride === RETURN_POLICY.NON_RETURNABLE) return false;
  if (productOverride === RETURN_POLICY.RETURNABLE) return true;
  if (productOverride === RETURN_POLICY.NON_RETURNABLE) return false;
  return null;
}

export function projectLegacyReturnPolicy({
  warehouseOverride = RETURN_POLICY.INHERIT,
  productOverride = RETURN_POLICY.INHERIT,
  offerOverride = RETURN_POLICY.INHERIT,
} = {}) {
  return {
    warehouseReturnableByDefault:
      legacyWarehouseReturnableByDefault(warehouseOverride),
    offerIsReturnable: legacyOfferIsReturnable({
      offerOverride,
      productOverride,
    }),
  };
}

function number(value) {
  return Number(value || 0);
}

function warehouseCounts(row = {}) {
  return {
    true: number(row.true_count),
    false: number(row.false_count),
  };
}

function offerCounts(row = {}) {
  return {
    null: number(row.null_count),
    true: number(row.true_count),
    false: number(row.false_count),
  };
}

async function currentLegacyCounts(db) {
  const [warehouses, offers] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE returnable_by_default = TRUE) AS true_count,
        COUNT(*) FILTER (WHERE returnable_by_default = FALSE) AS false_count
      FROM warehouses
    `),
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_returnable IS NULL) AS null_count,
        COUNT(*) FILTER (WHERE is_returnable = TRUE) AS true_count,
        COUNT(*) FILTER (WHERE is_returnable = FALSE) AS false_count
      FROM product_offers
    `),
  ]);
  return {
    warehouses: warehouseCounts(warehouses.rows[0]),
    offers: offerCounts(offers.rows[0]),
  };
}

async function projectedLegacyCounts(db) {
  const [warehouses, offers] = await Promise.all([
    db.query(`
      WITH projected AS (
        SELECT
          returnable_by_default AS current_value,
          CASE
            WHEN return_policy_override = 'NON_RETURNABLE' THEN FALSE
            ELSE TRUE
          END AS expected_value
        FROM warehouses
      )
      SELECT
        COUNT(*) FILTER (WHERE expected_value = TRUE) AS true_count,
        COUNT(*) FILTER (WHERE expected_value = FALSE) AS false_count,
        COUNT(*) FILTER (
          WHERE current_value IS DISTINCT FROM expected_value
            AND expected_value = TRUE
        ) AS change_to_true,
        COUNT(*) FILTER (
          WHERE current_value IS DISTINCT FROM expected_value
            AND expected_value = FALSE
        ) AS change_to_false
      FROM projected
    `),
    db.query(`
      WITH projected AS (
        SELECT
          po.is_returnable AS current_value,
          CASE
            WHEN po.return_policy_override = 'RETURNABLE' THEN TRUE
            WHEN po.return_policy_override = 'NON_RETURNABLE' THEN FALSE
            WHEN p.return_policy_override = 'RETURNABLE' THEN TRUE
            WHEN p.return_policy_override = 'NON_RETURNABLE' THEN FALSE
            ELSE NULL
          END AS expected_value
        FROM product_offers po
        JOIN products p ON p.id = po.product_id
      )
      SELECT
        COUNT(*) FILTER (WHERE expected_value IS NULL) AS null_count,
        COUNT(*) FILTER (WHERE expected_value = TRUE) AS true_count,
        COUNT(*) FILTER (WHERE expected_value = FALSE) AS false_count,
        COUNT(*) FILTER (
          WHERE current_value IS DISTINCT FROM expected_value
            AND expected_value IS NULL
        ) AS change_to_null,
        COUNT(*) FILTER (
          WHERE current_value IS DISTINCT FROM expected_value
            AND expected_value = TRUE
        ) AS change_to_true,
        COUNT(*) FILTER (
          WHERE current_value IS DISTINCT FROM expected_value
            AND expected_value = FALSE
        ) AS change_to_false
      FROM projected
    `),
  ]);
  const warehouseRow = warehouses.rows[0] || {};
  const offerRow = offers.rows[0] || {};
  return {
    after: {
      warehouses: warehouseCounts(warehouseRow),
      offers: offerCounts(offerRow),
    },
    changes: {
      warehouses: {
        toTrue: number(warehouseRow.change_to_true),
        toFalse: number(warehouseRow.change_to_false),
      },
      offers: {
        toNull: number(offerRow.change_to_null),
        toTrue: number(offerRow.change_to_true),
        toFalse: number(offerRow.change_to_false),
      },
    },
  };
}

async function applyLegacyProjection(db) {
  const warehouseResult = await db.query(`
    UPDATE warehouses
    SET returnable_by_default = CASE
      WHEN return_policy_override = 'NON_RETURNABLE' THEN FALSE
      ELSE TRUE
    END
    WHERE returnable_by_default IS DISTINCT FROM CASE
      WHEN return_policy_override = 'NON_RETURNABLE' THEN FALSE
      ELSE TRUE
    END
  `);
  const offerResult = await db.query(`
    UPDATE product_offers po
    SET is_returnable = CASE
      WHEN po.return_policy_override = 'RETURNABLE' THEN TRUE
      WHEN po.return_policy_override = 'NON_RETURNABLE' THEN FALSE
      WHEN p.return_policy_override = 'RETURNABLE' THEN TRUE
      WHEN p.return_policy_override = 'NON_RETURNABLE' THEN FALSE
      ELSE NULL
    END
    FROM products p
    WHERE p.id = po.product_id
      AND po.is_returnable IS DISTINCT FROM CASE
        WHEN po.return_policy_override = 'RETURNABLE' THEN TRUE
        WHEN po.return_policy_override = 'NON_RETURNABLE' THEN FALSE
        WHEN p.return_policy_override = 'RETURNABLE' THEN TRUE
        WHEN p.return_policy_override = 'NON_RETURNABLE' THEN FALSE
        ELSE NULL
      END
  `);
  return {
    warehouses: Number(warehouseResult.rowCount || 0),
    offers: Number(offerResult.rowCount || 0),
  };
}

export async function reconcileReturnPolicyToLegacy({
  apply = false,
  dbPool = pool,
} = {}) {
  const client = typeof dbPool.connect === "function"
    ? await dbPool.connect()
    : dbPool;
  const release = client !== dbPool && typeof client.release === "function";
  let transactionOpen = false;
  try {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    transactionOpen = true;
    const before = await currentLegacyCounts(client);
    const projection = await projectedLegacyCounts(client);
    const updated = apply
      ? await applyLegacyProjection(client)
      : { warehouses: 0, offers: 0 };
    const after = apply
      ? await currentLegacyCounts(client)
      : projection.after;

    if (apply) {
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    transactionOpen = false;
    return {
      mode: apply ? "APPLY" : "DRY_RUN",
      before,
      changes: projection.changes,
      after,
      updated,
      committed: apply,
    };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (release) client.release();
  }
}
