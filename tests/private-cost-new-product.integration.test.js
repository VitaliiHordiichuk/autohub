import assert from "node:assert/strict";
import test, { after } from "node:test";

import { pool } from "../src/config/db.js";
import { ImportReviewService } from "../src/services/ImportReviewService.js";
import { ImportService } from "../src/services/ImportService.js";

after(async () => pool.end());

test("warehouse-1 manual XLSX saves private cost for new AUTO and REVIEW products without profile opt-in", async () => {
  assert.match(process.env.DB_NAME ?? "", /_test$/i);
  const suffix = `${Date.now()}${process.pid}`.slice(-10);
  const autoArticle = `TSTCOSTA${suffix}`;
  const reviewArticle = `TSTCOSTR${suffix}`;
  const legacyArticle = `TSTCOSTL${suffix}`;
  const missingRowArticle = `TSTCOSTX${suffix}`;
  const partnerArticle = `TSTCOSTP${suffix}`;
  const filePrefix = `private-cost-new-product-${suffix}`;
  const profileResult = await pool.query(`
    SELECT wsi.id, wsi.is_active, wsi.new_products_mode, wsi.internal_purchase_price_column
    FROM warehouse_supplier_imports wsi
    JOIN supplier_import_settings sis ON sis.id = wsi.supplier_import_settings_id
    JOIN suppliers s ON s.id = wsi.supplier_id
    WHERE wsi.warehouse_id = 1 AND s.type = 'OWN'
    ORDER BY wsi.id LIMIT 1
  `);
  assert.equal(profileResult.rowCount, 1, "isolated fixture needs warehouse-1 own-source profile");
  const profile = profileResult.rows[0];
  const profileId = Number(profile.id);
  const partnerResult = await pool.query(`
    SELECT wsi.id, wsi.is_active, wsi.new_products_mode
    FROM warehouse_supplier_imports wsi
    JOIN suppliers s ON s.id = wsi.supplier_id
    WHERE wsi.warehouse_id = 1 AND s.type = 'PARTNER'
    ORDER BY wsi.id LIMIT 1
  `);
  assert.equal(partnerResult.rowCount, 1);
  const partnerProfile = partnerResult.rows[0];

  const row = (article, cost) => ({
    article, name: `Test cost ${article}`, quantity: 2, price: 100,
    retailPrice: 150, internalUnitCost: cost, rowNumber: 3,
    rawData: [article, `Test cost ${article}`, 2, 100, 150, cost],
  });
  const context = (name) => ({
    warehouseId: 1, warehouseSupplierImportId: profileId,
    fileName: `${filePrefix}-${name}.xlsx`, fileType: "XLSX", importMethod: "MANUAL",
  });
  const offer = async (article) => {
    const result = await pool.query(`
      SELECT po.id, po.quantity, po.purchase_price, pic.unit_cost
      FROM products p
      JOIN product_offers po ON po.product_id = p.id AND po.warehouse_id = 1
      LEFT JOIN product_offer_internal_costs pic ON pic.product_offer_id = po.id
      WHERE p.article_normalized = $1
    `, [article]);
    return result.rows[0] ?? null;
  };

  try {
    await pool.query(`
      UPDATE warehouse_supplier_imports
      SET is_active = TRUE, internal_purchase_price_column = NULL, new_products_mode = 'AUTO'
      WHERE id = $1
    `, [profileId]);
    const auto = await ImportService.importRows(context("auto"), [row(autoArticle, "41.123456")]);
    assert.equal(auto.errors, 0);
    assert.equal(auto.successRows, 1);
    assert.equal(Number((await offer(autoArticle))?.unit_cost), 41.123456);
    assert.equal(Number((await offer(autoArticle))?.purchase_price), 100);
    assert.equal(Number((await offer(autoArticle))?.quantity), 2);

    await pool.query(`
      UPDATE warehouse_supplier_imports SET new_products_mode = 'REVIEW' WHERE id = $1
    `, [profileId]);
    const reviewedImport = await ImportService.importRows(context("review"), [row(reviewArticle, "32.654321")]);
    assert.equal(reviewedImport.errors, 0);
    assert.equal(reviewedImport.pendingNewProducts, 1);
    assert.equal(await offer(reviewArticle), null);
    const snapshot = await pool.query(`SELECT private_cost_column FROM imports WHERE id = $1`, [reviewedImport.importId]);
    assert.equal(snapshot.rows[0]?.private_cost_column, 6);
    await pool.query(`
      UPDATE warehouse_supplier_imports SET internal_purchase_price_column = 5 WHERE id = $1
    `, [profileId]);
    const pending = await ImportReviewService.getPending({ warehouseId: 1 });
    const review = pending.items.find((item) => item.articleNormalized === reviewArticle);
    assert.ok(review);
    const approved = await ImportReviewService.approve(review.id);
    assert.equal(approved.status, "APPROVED");
    assert.equal(Number((await offer(reviewArticle))?.unit_cost), 32.654321);
    assert.equal(Number((await offer(reviewArticle))?.purchase_price), 100);
    assert.equal(Number((await offer(reviewArticle))?.quantity), 2);
    await pool.query(`
      UPDATE warehouse_supplier_imports SET internal_purchase_price_column = NULL WHERE id = $1
    `, [profileId]);

    const legacyImport = await ImportService.importRows(context("legacy"), [row(legacyArticle, "25.000001")]);
    await pool.query(`UPDATE imports SET private_cost_column = NULL WHERE id = $1`, [legacyImport.importId]);
    const legacyPending = await ImportReviewService.getPending({ warehouseId: 1 });
    const legacy = legacyPending.items.find((item) => item.articleNormalized === legacyArticle);
    assert.ok(legacy);
    await assert.rejects(ImportReviewService.approve(legacy.id), /ручная проверка/);
    assert.equal(await offer(legacyArticle), null);

    const missingRowImport = await ImportService.importRows(context("missing-row"), [row(missingRowArticle, "24.000001")]);
    const missingRowPending = await ImportReviewService.getPending({ warehouseId: 1 });
    const missingRow = missingRowPending.items.find((item) => item.articleNormalized === missingRowArticle);
    assert.ok(missingRow);
    await pool.query(`DELETE FROM import_rows WHERE import_id = $1`, [missingRowImport.importId]);
    await assert.rejects(ImportReviewService.approve(missingRow.id), /исходная строка XLSX/);
    assert.equal(await offer(missingRowArticle), null);

    await pool.query(`
      UPDATE warehouse_supplier_imports
      SET is_active = TRUE, new_products_mode = 'REVIEW'
      WHERE id = $1
    `, [partnerProfile.id]);
    const partnerImport = await ImportService.importRows({
      warehouseId: 1, warehouseSupplierImportId: Number(partnerProfile.id),
      fileName: `${filePrefix}-partner.xlsx`, fileType: "XLSX", importMethod: "MANUAL",
    }, [row(partnerArticle, null)]);
    assert.equal(partnerImport.pendingNewProducts, 1);
    const partnerPending = await ImportReviewService.getPending({ warehouseId: 1 });
    const partner = partnerPending.items.find((item) => item.articleNormalized === partnerArticle);
    assert.ok(partner);
    assert.equal((await ImportReviewService.approve(partner.id)).status, "APPROVED");
    assert.equal((await offer(partnerArticle))?.unit_cost, null);

    await assert.rejects(
      ImportService.importRows(context("missing-cost"), [row(`TSTCOSTM${suffix}`, null)]),
      /реальная входящая цена/,
    );
  } finally {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(`
        UPDATE warehouse_supplier_imports
        SET is_active = $2, new_products_mode = $3, internal_purchase_price_column = $4
        WHERE id = $1
      `, [profileId, profile.is_active, profile.new_products_mode, profile.internal_purchase_price_column]);
      await db.query(`
        UPDATE warehouse_supplier_imports SET is_active = $2, new_products_mode = $3 WHERE id = $1
      `, [partnerProfile.id, partnerProfile.is_active, partnerProfile.new_products_mode]);
      await db.query(`
        DELETE FROM import_new_products WHERE article_normalized = ANY($1::text[])
      `, [[autoArticle, reviewArticle, legacyArticle, missingRowArticle, partnerArticle]]);
      await db.query(`
        DELETE FROM price_history WHERE product_offer_id IN (
          SELECT po.id FROM product_offers po JOIN products p ON p.id = po.product_id
          WHERE p.article_normalized = ANY($1::text[]) AND po.warehouse_id = 1
        )
      `, [[autoArticle, reviewArticle, legacyArticle, missingRowArticle, partnerArticle]]);
      await db.query(`DELETE FROM imports WHERE file_name LIKE $1`, [`${filePrefix}-%`]);
      await db.query(`
        DELETE FROM product_offers WHERE product_id IN (
          SELECT id FROM products WHERE article_normalized = ANY($1::text[])
        ) AND warehouse_id = 1
      `, [[autoArticle, reviewArticle, legacyArticle, missingRowArticle, partnerArticle]]);
      await db.query(`DELETE FROM products WHERE article_normalized = ANY($1::text[])`, [[autoArticle, reviewArticle, legacyArticle, missingRowArticle, partnerArticle]]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
});
