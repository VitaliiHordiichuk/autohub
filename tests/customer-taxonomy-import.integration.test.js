import assert from "node:assert/strict";
import test, { after } from "node:test";

import { pool } from "../src/config/db.js";
import { ImportReviewService } from "../src/services/ImportReviewService.js";
import { ImportService } from "../src/services/ImportService.js";
import { SupplierService } from "../src/services/SupplierService.js";
import { WarehouseImportProfileService } from "../src/services/WarehouseImportProfileService.js";
import { WarehouseService } from "../src/services/WarehouseService.js";

const exhaustArticles = [
  "A0004901241",
  "A0004901341",
  "A0004901441",
  "A0004901541",
  "A0004901641",
  "A0004902141",
  "A2024900841",
  "A2034900441",
  "A2034900641",
];
const steeringArticles = ["A0024662201", "A0024668801"];
const historicalArticles = [...exhaustArticles, ...steeringArticles];

after(async () => {
  await pool.end();
});

async function productMap(articles) {
  const result = await pool.query(`
    SELECT id, article, article_normalized, name
    FROM products
    WHERE article_normalized = ANY($1::text[])
    ORDER BY article_normalized
  `, [articles]);
  assert.equal(result.rowCount, articles.length);
  return new Map(result.rows.map((row) => [row.article_normalized, {
    id: Number(row.id),
    article: row.article,
    articleNormalized: row.article_normalized,
    name: row.name,
  }]));
}

async function captureMembershipRows(productIds) {
  const result = await pool.query(`
    SELECT *
    FROM product_customer_categories
    WHERE product_id = ANY($1::integer[])
    ORDER BY product_id, customer_category_id
  `, [productIds]);
  return result.rows;
}

function stableMembershipRows(rows) {
  return rows.map((row) => ({
    productId: Number(row.product_id),
    customerCategoryId: Number(row.customer_category_id),
    isPrimary: row.is_primary,
    assignmentSource: row.assignment_source,
    assignmentOrigin: row.assignment_origin,
    ruleCode: row.rule_code,
    ruleVersion: row.rule_version === null ? null : Number(row.rule_version),
    confidence: row.confidence,
    approvalStatus: row.approval_status,
    approvedBy: row.approved_by === null ? null : Number(row.approved_by),
  }));
}

async function restoreMembershipRows(productIds, rows, db = pool) {
  await db.query(`
    DELETE FROM product_customer_categories
    WHERE product_id = ANY($1::integer[])
  `, [productIds]);
  for (const row of rows) {
    await db.query(`
      INSERT INTO product_customer_categories(
        product_id, customer_category_id, is_primary, assignment_source,
        assignment_origin, rule_code, rule_version, confidence,
        approval_status, assigned_at, approved_at, approved_by, updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      row.product_id,
      row.customer_category_id,
      row.is_primary,
      row.assignment_source,
      row.assignment_origin,
      row.rule_code,
      row.rule_version,
      row.confidence,
      row.approval_status,
      row.assigned_at,
      row.approved_at,
      row.approved_by,
      row.updated_at,
    ]);
  }
}

async function seedHistoricalMemberships(products) {
  const categories = await pool.query(`
    SELECT id, slug
    FROM customer_categories
    WHERE slug IN ('exhaust-mounts', 'steering-pumps')
  `);
  const categoryBySlug = new Map(categories.rows.map((row) => [row.slug, Number(row.id)]));
  assert.equal(categoryBySlug.size, 2);

  const rules = await pool.query(`
    SELECT code, version, is_active
    FROM customer_classification_rules
    WHERE (code = 'EXHAUST_MOUNT_A_EPC49_V1' AND version = 2)
       OR (code = 'STEERING_PUMP_A_EPC46_V1' AND is_active = TRUE)
    ORDER BY code, version DESC
  `);
  const exhaustRule = rules.rows.find((row) => row.code === "EXHAUST_MOUNT_A_EPC49_V1");
  const steeringRule = rules.rows.find((row) => row.code === "STEERING_PUMP_A_EPC46_V1");
  assert.ok(exhaustRule);
  assert.equal(exhaustRule.is_active, false);
  assert.ok(steeringRule);
  assert.equal(steeringRule.is_active, true);

  const productIds = [...products.values()].map((item) => item.id);
  await pool.query(`
    DELETE FROM product_customer_categories
    WHERE product_id = ANY($1::integer[])
  `, [productIds]);

  for (const article of historicalArticles) {
    const exhaust = exhaustArticles.includes(article);
    await pool.query(`
      INSERT INTO product_customer_categories(
        product_id, customer_category_id, is_primary, assignment_source,
        assignment_origin, rule_code, rule_version, confidence,
        approval_status, assigned_at, approved_at, updated_at
      ) VALUES(
        $1, $2, TRUE, 'RULE', 'BACKFILL', $3, $4,
        'HIGH', 'AUTO_APPROVED', clock_timestamp(), clock_timestamp(), clock_timestamp()
      )
    `, [
      products.get(article).id,
      categoryBySlug.get(exhaust ? "exhaust-mounts" : "steering-pumps"),
      exhaust ? exhaustRule.code : steeringRule.code,
      Number(exhaust ? exhaustRule.version : steeringRule.version),
    ]);
  }
}

async function membershipForArticle(article) {
  const result = await pool.query(`
    SELECT
      membership.*,
      category.slug AS category_slug
    FROM products product
    LEFT JOIN product_customer_categories membership
      ON membership.product_id = product.id
    LEFT JOIN customer_categories category
      ON category.id = membership.customer_category_id
    WHERE product.article_normalized = $1
    ORDER BY membership.is_primary DESC, membership.customer_category_id
  `, [article]);
  return result.rows.filter((row) => row.customer_category_id !== null);
}

async function saveProfile({ warehouseId, brandId, newProductsMode }) {
  return WarehouseImportProfileService.saveProfile(warehouseId, {
    fileType: "CSV",
    brandMode: "FIXED",
    fixedBrandId: brandId,
    articleColumn: 1,
    nameColumn: 2,
    priceColumn: 3,
    quantityColumn: 4,
    startRow: 1,
    isActive: true,
    emailAutoImportEnabled: false,
    newProductsMode,
  });
}

test("supplier and reviewed imports classify taxonomy while preserving approved history", async () => {
  const token = `${process.pid}${Date.now()}`;
  const model = String(100 + (Number(token.slice(-3)) % 800)).padStart(3, "0");
  const highArticle = `A${model}1800001`;
  const safeArticle = `A${model}4600002`;
  const unclassifiedArticle = `A${model}9900003`;
  const reviewArticle = `A${model}1800004`;
  const unsupportedArticle = `PHASE3E${token}`;
  const dynamicArticles = [
    highArticle,
    safeArticle,
    unclassifiedArticle,
    reviewArticle,
    unsupportedArticle,
  ];

  let supplierId = null;
  let warehouseId = null;
  let settingsId = null;
  let warehouseSupplierImportId = null;
  const historicalProducts = await productMap(historicalArticles);
  const historicalProductIds = [...historicalProducts.values()].map((item) => item.id);
  const historicalBaseline = await captureMembershipRows(historicalProductIds);

  try {
    await seedHistoricalMemberships(historicalProducts);
    const seededHistory = stableMembershipRows(
      await captureMembershipRows(historicalProductIds),
    );

    const brandResult = await pool.query(`
      SELECT id
      FROM brands
      WHERE LOWER(name) = LOWER('Mercedes-Benz')
      ORDER BY id
      LIMIT 1
    `);
    assert.equal(brandResult.rowCount, 1);
    const brandId = Number(brandResult.rows[0].id);

    const supplier = await SupplierService.createSupplier({
      name: `PHASE 3E IMPORT ${token}`,
      type: "PARTNER",
      warehousePriorityEnabled: false,
    });
    supplierId = Number(supplier.id);
    const warehouse = await WarehouseService.createWarehouse({
      supplierId,
      name: `PHASE 3E WAREHOUSE ${token}`,
      city: "TEST",
      type: "SUPPLIER",
      deliveryDays: 1,
    });
    warehouseId = Number(warehouse.id);
    const autoProfile = await saveProfile({
      warehouseId,
      brandId,
      newProductsMode: "AUTO",
    });
    settingsId = Number(autoProfile.profile.supplierImportSettingsId);
    warehouseSupplierImportId = Number(autoProfile.profile.id);

    const first = await ImportService.importRows({
      warehouseId,
      warehouseSupplierImportId,
      fileName: "phase3e-first.csv",
      fileType: "CSV",
      importMethod: "MANUAL",
    }, [
      { article: highArticle, name: "Фільтр масляний", price: 100, quantity: 3 },
      { article: safeArticle, name: "Деталь", price: 110, quantity: 2 },
      { article: unclassifiedArticle, name: "Деталь", price: 120, quantity: 1 },
      { article: unsupportedArticle, name: "Деталь", price: 130, quantity: 1 },
      ...historicalArticles.map((article, index) => ({
        article,
        name: `Змінена назва постачальника ${index + 1}`,
        price: 200 + index,
        quantity: 1,
      })),
    ]);

    assert.equal(first.errors, 0);
    assert.equal(first.successRows, 15);
    assert.equal(first.taxonomyProcessed, 15);
    assert.equal(first.taxonomyAssignedHigh, 1);
    assert.equal(first.taxonomyAssignedSafe, 1);
    assert.equal(first.taxonomyPreservedApproved, 11);
    assert.equal(first.taxonomyUnclassified, 1);
    assert.equal(first.taxonomyUnsupported, 1);
    assert.equal(first.taxonomyErrors, 0);

    const highMembership = await membershipForArticle(highArticle);
    assert.equal(highMembership.length, 1);
    assert.equal(highMembership[0].category_slug, "filters-oil");
    assert.equal(highMembership[0].assignment_source, "RULE");
    assert.equal(highMembership[0].assignment_origin, "IMPORT");
    assert.equal(highMembership[0].confidence, "HIGH");

    const safeMembership = await membershipForArticle(safeArticle);
    assert.equal(safeMembership.length, 1);
    assert.equal(safeMembership[0].category_slug, "steering");
    assert.equal(safeMembership[0].assignment_source, "EPC_FALLBACK");
    assert.equal(safeMembership[0].assignment_origin, "IMPORT");
    assert.equal(safeMembership[0].confidence, "MEDIUM");

    assert.equal((await membershipForArticle(unclassifiedArticle)).length, 0);
    assert.equal((await membershipForArticle(unsupportedArticle)).length, 0);
    assert.deepEqual(
      stableMembershipRows(await captureMembershipRows(historicalProductIds)),
      seededHistory,
    );

    const filterCategory = await pool.query(`
      SELECT id, is_active
      FROM customer_categories
      WHERE slug = 'filters-oil'
    `);
    assert.equal(filterCategory.rowCount, 1);
    assert.equal(filterCategory.rows[0].is_active, true);
    await pool.query(`
      UPDATE customer_categories
      SET is_active = FALSE
      WHERE id = $1
    `, [filterCategory.rows[0].id]);
    try {
      const failedTaxonomyRow = await ImportService.importRows({
        warehouseId,
        warehouseSupplierImportId,
        fileName: "phase3e-taxonomy-error.csv",
        fileType: "CSV",
        importMethod: "MANUAL",
      }, [
        { article: highArticle, name: "Фільтр масляний", price: 999, quantity: 9 },
      ]);
      assert.equal(failedTaxonomyRow.successRows, 0);
      assert.equal(failedTaxonomyRow.errors, 1);
      assert.equal(failedTaxonomyRow.taxonomyProcessed, 1);
      assert.equal(failedTaxonomyRow.taxonomyErrors, 1);
      const rolledBackOffer = await pool.query(`
        SELECT offer.purchase_price, offer.quantity
        FROM product_offers offer
        JOIN products product ON product.id = offer.product_id
        WHERE offer.warehouse_id = $1
          AND product.article_normalized = $2
      `, [warehouseId, highArticle]);
      assert.equal(rolledBackOffer.rowCount, 1);
      assert.equal(Number(rolledBackOffer.rows[0].purchase_price), 100);
      assert.equal(Number(rolledBackOffer.rows[0].quantity), 3);
    } finally {
      await pool.query(`
        UPDATE customer_categories
        SET is_active = TRUE
        WHERE id = $1
      `, [filterCategory.rows[0].id]);
    }

    const replacement = await ImportService.importRows({
      warehouseId,
      warehouseSupplierImportId,
      fileName: "phase3e-full-replace.csv",
      fileType: "CSV",
      importMethod: "MANUAL",
    }, [
      { article: highArticle, name: "Інша назва фільтра", price: 105, quantity: 4 },
    ]);
    assert.equal(replacement.errors, 0);
    assert.equal(replacement.taxonomyPreservedApproved, 1);
    assert.equal((await membershipForArticle(highArticle)).length, 1);
    assert.deepEqual(
      stableMembershipRows(await membershipForArticle(safeArticle)),
      stableMembershipRows(safeMembership),
    );
    const disabledSafeOffer = await pool.query(`
      SELECT offer.quantity, offer.is_available
      FROM product_offers offer
      JOIN products product ON product.id = offer.product_id
      WHERE offer.warehouse_id = $1
        AND product.article_normalized = $2
    `, [warehouseId, safeArticle]);
    assert.equal(disabledSafeOffer.rowCount, 1);
    assert.equal(Number(disabledSafeOffer.rows[0].quantity), 0);
    assert.equal(disabledSafeOffer.rows[0].is_available, false);

    const returned = await ImportService.importRows({
      warehouseId,
      warehouseSupplierImportId,
      fileName: "phase3e-returned.csv",
      fileType: "CSV",
      importMethod: "MANUAL",
    }, [
      { article: highArticle, name: "Фільтр масляний", price: 106, quantity: 4 },
      { article: safeArticle, name: "Деталь", price: 111, quantity: 2 },
    ]);
    assert.equal(returned.errors, 0);
    assert.equal(returned.taxonomyPreservedApproved, 2);
    assert.equal((await membershipForArticle(highArticle)).length, 1);
    assert.equal((await membershipForArticle(safeArticle)).length, 1);

    await saveProfile({ warehouseId, brandId, newProductsMode: "REVIEW" });
    const reviewImport = await ImportService.importRows({
      warehouseId,
      warehouseSupplierImportId,
      fileName: "phase3e-review.csv",
      fileType: "CSV",
      importMethod: "MANUAL",
    }, [
      { article: reviewArticle, name: "Фільтр масляний", price: 140, quantity: 2 },
    ]);
    assert.equal(reviewImport.errors, 0);
    assert.equal(reviewImport.pendingNewProducts, 1);
    assert.equal(reviewImport.taxonomyProcessed, 0);

    const pending = await ImportReviewService.getPending({ warehouseId });
    const pendingReview = pending.items.find((item) => (
      item.articleNormalized === reviewArticle
    ));
    assert.ok(pendingReview);
    const approved = await ImportReviewService.approve(pendingReview.id);
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.taxonomy.decision, "ASSIGNED_NEW_HIGH");
    assert.equal(approved.taxonomy.finalCategory, "filters-oil");
    const reviewedMembership = await membershipForArticle(reviewArticle);
    assert.equal(reviewedMembership.length, 1);
    assert.equal(reviewedMembership[0].assignment_origin, "IMPORT");
    assert.equal(reviewedMembership[0].assignment_source, "RULE");

    assert.deepEqual(
      stableMembershipRows(await captureMembershipRows(historicalProductIds)),
      seededHistory,
    );
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await restoreMembershipRows(historicalProductIds, historicalBaseline, cleanup);
      if (warehouseId !== null) {
        await cleanup.query(`
          DELETE FROM price_history
          WHERE product_offer_id IN (
            SELECT id FROM product_offers WHERE warehouse_id = $1
          )
        `, [warehouseId]);
        await cleanup.query("DELETE FROM import_new_products WHERE warehouse_id = $1", [warehouseId]);
        await cleanup.query("DELETE FROM imports WHERE warehouse_id = $1", [warehouseId]);
        await cleanup.query("DELETE FROM product_offers WHERE warehouse_id = $1", [warehouseId]);
      }
      if (warehouseSupplierImportId !== null) {
        await cleanup.query(
          "DELETE FROM warehouse_supplier_imports WHERE id = $1",
          [warehouseSupplierImportId],
        );
      }
      if (settingsId !== null) {
        await cleanup.query(
          "DELETE FROM supplier_import_settings WHERE id = $1",
          [settingsId],
        );
      }
      if (warehouseId !== null) {
        await cleanup.query("DELETE FROM warehouses WHERE id = $1", [warehouseId]);
      }
      if (supplierId !== null) {
        await cleanup.query("DELETE FROM suppliers WHERE id = $1", [supplierId]);
      }
      await cleanup.query(`
        DELETE FROM products
        WHERE article_normalized = ANY($1::text[])
      `, [dynamicArticles]);
      await cleanup.query("COMMIT");
    } catch (error) {
      await cleanup.query("ROLLBACK");
      throw error;
    } finally {
      cleanup.release();
    }
  }
});
