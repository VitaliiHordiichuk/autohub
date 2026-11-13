import assert from "node:assert/strict";
import test from "node:test";

import { pool } from "../src/config/db.js";
import {
  runUncategorizedBackfill,
  UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION,
  UNCATEGORIZED_BACKFILL_RESTORE_CONFIRMATION,
} from "../src/services/CustomerTaxonomyUncategorizedBackfillService.js";

test("bounded new-product backfill is dry-run by default and exactly reversible", async () => {
  const article = `A99767${String((Date.now() + process.pid) % 100000).padStart(5, "0")}`;
  const inserted = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Скло лобове', TRUE) RETURNING id
  `, [article]);
  const productId = Number(inserted.rows[0].id);
  try {
    const dry = await runUncategorizedBackfill({ afterId: productId - 1, limit: 1 });
    assert.equal(dry.mode, "DRY_RUN");
    assert.equal(dry.counts.autoHigh, 1);
    assert.equal(dry.rows[0].categorySlug, "body-windshields");
    assert.equal(dry.plan.length, 1);
    const before = await pool.query(
      "SELECT COUNT(*)::integer AS count FROM product_customer_categories WHERE product_id = $1",
      [productId],
    );
    assert.equal(before.rows[0].count, 0);

    const applied = await runUncategorizedBackfill({
      mode: "APPLY",
      plan: dry.plan,
      confirmation: UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION,
    });
    assert.deepEqual(applied.applied, [productId]);
    const after = await pool.query(`
      SELECT membership.assignment_source, membership.assignment_origin,
             membership.is_primary, category.slug
      FROM product_customer_categories membership
      JOIN customer_categories category ON category.id = membership.customer_category_id
      WHERE membership.product_id = $1
    `, [productId]);
    assert.deepEqual(after.rows, [{
      assignment_source: "RULE",
      assignment_origin: "BACKFILL",
      is_primary: true,
      slug: "body-windshields",
    }]);

    await assert.rejects(() => runUncategorizedBackfill({
      mode: "APPLY", plan: dry.plan,
      confirmation: UNCATEGORIZED_BACKFILL_APPLY_CONFIRMATION,
    }), /Stale backfill plan/);
    const restored = await runUncategorizedBackfill({
      mode: "RESTORE", plan: dry.plan,
      confirmation: UNCATEGORIZED_BACKFILL_RESTORE_CONFIRMATION,
    });
    assert.deepEqual(restored.restored, [productId]);
    const final = await pool.query(
      "SELECT COUNT(*)::integer AS count FROM product_customer_categories WHERE product_id = $1",
      [productId],
    );
    assert.equal(final.rows[0].count, 0);
  } finally {
    await pool.query("DELETE FROM product_customer_categories WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
    await pool.end();
  }
});
