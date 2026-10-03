import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { CustomerTaxonomyRepository } from "../src/repositories/CustomerTaxonomyRepository.js";
import { runCustomerTaxonomyPreview } from "../src/services/CustomerTaxonomyPreviewService.js";

const suffix = `${process.pid}-${Date.now()}`;
const ids = {
  product: null,
  categories: [],
  ruleCodes: [
    `TEST_RULE_IMPORT_${suffix}`,
    `TEST_RULE_BACKFILL_${suffix}`,
    `TEST_EPC_SYSTEM_${suffix}`,
  ],
};

async function expectConstraint(promise, expectedCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, expectedCode);
    return true;
  });
}

before(async () => {
  const product = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $2, $3, TRUE)
    RETURNING id
  `, [`CTX-${suffix}`, `CTX${suffix.replace(/[^A-Z0-9]/gi, "")}`.toUpperCase(), "Customer taxonomy fixture"]);
  ids.product = Number(product.rows[0].id);
});

after(async () => {
  if (ids.product) {
    await pool.query("DELETE FROM product_customer_categories WHERE product_id = $1", [ids.product]);
  }
  await pool.query(
    "DELETE FROM customer_classification_rules WHERE code = ANY($1::varchar[])",
    [ids.ruleCodes],
  );
  for (const id of [...ids.categories].reverse()) {
    await pool.query("DELETE FROM customer_categories WHERE id = $1", [id]);
  }
  if (ids.product) await pool.query("DELETE FROM products WHERE id = $1", [ids.product]);
  await pool.end();
});

test("initial taxonomy contains hidden READY structure, seeded rules and zero memberships", async () => {
  const topLevel = await pool.query(`
    SELECT category.id, category.slug, category.status,
           category.is_active, category.is_navigation_visible,
           COUNT(translation.language_code)::integer AS translation_count
    FROM customer_categories category
    JOIN customer_category_translations translation
      ON translation.category_id = category.id
    WHERE category.parent_id IS NULL
    GROUP BY category.id
    ORDER BY category.sort_order, category.id
  `);
  assert.equal(topLevel.rowCount, 16);
  assert.ok(topLevel.rows.every((row) => (
    row.status === "ACTIVE"
    && row.is_active === true
    && row.is_navigation_visible === false
    && row.translation_count === 3
  )));

  const leaves = await pool.query(`
    SELECT parent.slug AS parent_slug, COUNT(*)::integer AS count
    FROM customer_categories leaf
    JOIN customer_categories parent ON parent.id = leaf.parent_id
    GROUP BY parent.slug
    ORDER BY parent.slug
  `);
  assert.deepEqual(leaves.rows, [
    { parent_slug: "accessories", count: 7 },
    { parent_slug: "brakes", count: 6 },
    { parent_slug: "filters-maintenance", count: 8 },
  ]);

  const incompleteTranslations = await pool.query(`
    SELECT category.id
    FROM customer_categories category
    LEFT JOIN customer_category_translations translation
      ON translation.category_id = category.id
      AND translation.language_code IN ('uk', 'ru', 'en')
    GROUP BY category.id
    HAVING COUNT(translation.language_code) <> 3
  `);
  assert.equal(incompleteTranslations.rowCount, 0);

  const seededFoundation = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM customer_classification_rules) AS rule_count,
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS membership_count
  `);
  assert.deepEqual(seededFoundation.rows[0], {
    rule_count: 119,
    membership_count: 0,
  });
});

test("category tree rejects direct self-parent and indirect A -> B -> C -> A cycle", async () => {
  for (const name of ["a", "b", "c"]) {
    const result = await pool.query(`
      INSERT INTO customer_categories(
        slug, status, is_active, is_navigation_visible
      )
      VALUES($1, 'DRAFT', FALSE, FALSE)
      RETURNING id
    `, [`test-cycle-${name}-${suffix}`]);
    ids.categories.push(Number(result.rows[0].id));
  }
  const [a, b, c] = ids.categories;
  await CustomerTaxonomyRepository.setCategoryParent({ categoryId: b, parentId: a });
  await CustomerTaxonomyRepository.setCategoryParent({ categoryId: c, parentId: b });

  await expectConstraint(
    pool.query("UPDATE customer_categories SET parent_id = id WHERE id = $1", [a]),
    "23514",
  );
  await assert.rejects(
    CustomerTaxonomyRepository.setCategoryParent({ categoryId: a, parentId: c }),
    (error) => error.code === "CUSTOMER_CATEGORY_CYCLE",
  );
});

test("assignment_source and assignment_origin are independent and invalid source is rejected", async () => {
  const categories = await pool.query(`
    SELECT id, slug
    FROM customer_categories
    WHERE slug IN ('filters-oil', 'filters-engine-air', 'brakes-pads', 'accessories')
    ORDER BY slug
  `);
  const categoryBySlug = new Map(categories.rows.map((row) => [row.slug, Number(row.id)]));
  const ruleDefinitions = [
    [ids.ruleCodes[0], categoryBySlug.get("filters-oil"), "FILTER_OIL"],
    [ids.ruleCodes[1], categoryBySlug.get("filters-engine-air"), "FILTER_AIR_ENGINE"],
  ];
  for (const [code, categoryId, typeCode] of ruleDefinitions) {
    await pool.query(`
      INSERT INTO customer_classification_rules(
        code, version, detector_version, source_kind, assignment_role,
        match_type, match_value, target_category_id, priority,
        confidence, auto_approval_allowed, is_active
      )
      VALUES($1, 1, 1, 'RULE', 'PRIMARY', 'TYPE_CODE', $2, $3,
             100, 'HIGH', FALSE, TRUE)
    `, [code, typeCode, categoryId]);
  }
  await pool.query(`
    INSERT INTO customer_classification_rules(
      code, version, detector_version, source_kind, assignment_role,
      epc_group, match_type, target_category_id, priority,
      confidence, auto_approval_allowed, is_active
    )
    VALUES($1, 1, 1, 'EPC_FALLBACK', 'SECONDARY', '18', 'EPC_ONLY',
           $2, 200, 'HIGH', TRUE, TRUE)
  `, [ids.ruleCodes[2], categoryBySlug.get("accessories")]);

  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, assignment_source, assignment_origin,
      rule_code, rule_version, confidence, approval_status, approved_at
    ) VALUES
      ($1, $2, 'RULE', 'IMPORT', $3, 1, 'HIGH', 'REVIEW', NULL),
      ($1, $4, 'RULE', 'BACKFILL', $5, 1, 'HIGH', 'REVIEW', NULL),
      ($1, $6, 'MANUAL', 'ADMIN', NULL, NULL, 'HIGH', 'MANUAL_APPROVED', NOW()),
      ($1, $7, 'EPC_FALLBACK', 'SYSTEM', $8, 1, 'HIGH', 'AUTO_APPROVED', NOW())
  `, [
    ids.product,
    categoryBySlug.get("filters-oil"),
    ids.ruleCodes[0],
    categoryBySlug.get("filters-engine-air"),
    ids.ruleCodes[1],
    categoryBySlug.get("brakes-pads"),
    categoryBySlug.get("accessories"),
    ids.ruleCodes[2],
  ]);

  const combinations = await pool.query(`
    SELECT assignment_source, assignment_origin
    FROM product_customer_categories
    WHERE product_id = $1
    ORDER BY assignment_origin
  `, [ids.product]);
  assert.deepEqual(combinations.rows, [
    { assignment_source: "MANUAL", assignment_origin: "ADMIN" },
    { assignment_source: "RULE", assignment_origin: "BACKFILL" },
    { assignment_source: "RULE", assignment_origin: "IMPORT" },
    { assignment_source: "EPC_FALLBACK", assignment_origin: "SYSTEM" },
  ]);

  await expectConstraint(pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, assignment_source, assignment_origin,
      confidence, approval_status
    ) VALUES($1, $2, 'IMPORT', 'IMPORT', 'HIGH', 'REVIEW')
  `, [ids.product, categoryBySlug.get("accessories")]), "23514");
});

test("duplicate membership and second primary path are prohibited", async () => {
  const existing = await pool.query(`
    SELECT customer_category_id
    FROM product_customer_categories
    WHERE product_id = $1
    ORDER BY customer_category_id
    LIMIT 1
  `, [ids.product]);
  await expectConstraint(pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, assignment_source, assignment_origin,
      rule_code, rule_version, confidence, approval_status
    ) VALUES($1, $2, 'RULE', 'IMPORT', $3, 1, 'HIGH', 'REVIEW')
  `, [ids.product, existing.rows[0].customer_category_id, ids.ruleCodes[0]]), "23505");

  const primaryCategories = await pool.query(`
    SELECT id, slug FROM customer_categories
    WHERE slug IN ('brakes-pads', 'brakes-discs')
  `);
  const categoryBySlug = new Map(
    primaryCategories.rows.map((row) => [row.slug, Number(row.id)]),
  );
  const first = categoryBySlug.get("brakes-pads");
  const second = categoryBySlug.get("brakes-discs");
  await pool.query(`
    UPDATE product_customer_categories
    SET is_primary = TRUE, approved_at = NOW()
    WHERE product_id = $1 AND customer_category_id = $2
  `, [ids.product, first]);
  await expectConstraint(pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary,
      assignment_source, assignment_origin, confidence,
      approval_status, approved_at
    ) VALUES($1, $2, TRUE, 'MANUAL', 'ADMIN', 'HIGH',
             'MANUAL_APPROVED', NOW())
  `, [ids.product, second]), "23505");
});

test("customer taxonomy operations and offer-only updates do not change EPC memberships", async () => {
  const before = await pool.query(`
    SELECT category_id, assignment_source, confidence
    FROM product_categories
    WHERE product_id = $1
    ORDER BY category_id
  `, [ids.product]);
  const offer = await pool.query("SELECT id, product_id FROM product_offers ORDER BY id LIMIT 1");
  if (offer.rowCount) {
    const offerProductId = Number(offer.rows[0].product_id);
    const membershipCountBefore = await pool.query(
      "SELECT COUNT(*)::integer AS count FROM product_customer_categories WHERE product_id = $1",
      [offerProductId],
    );
    await pool.query("UPDATE product_offers SET quantity = quantity WHERE id = $1", [offer.rows[0].id]);
    const membershipCountAfter = await pool.query(
      "SELECT COUNT(*)::integer AS count FROM product_customer_categories WHERE product_id = $1",
      [offerProductId],
    );
    assert.equal(membershipCountAfter.rows[0].count, membershipCountBefore.rows[0].count);
  }
  const afterResult = await pool.query(`
    SELECT category_id, assignment_source, confidence
    FROM product_categories
    WHERE product_id = $1
    ORDER BY category_id
  `, [ids.product]);
  assert.deepEqual(afterResult.rows, before.rows);
});

test("preview makes zero membership and EPC writes", async () => {
  const before = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS customer_count,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_count
  `);
  const report = await runCustomerTaxonomyPreview({ dbPool: pool });
  assert.equal(report.mode, "DRY_RUN");
  const afterResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS customer_count,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_count
  `);
  assert.deepEqual(afterResult.rows[0], before.rows[0]);
});
