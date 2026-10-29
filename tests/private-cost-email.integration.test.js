import assert from "node:assert/strict";
import test, { after } from "node:test";
import * as XLSX from "xlsx";

import { app } from "../src/app.js";
import { pool } from "../src/config/db.js";
import { EmailImportRuleRepository } from "../src/repositories/EmailImportRuleRepository.js";
import { importAttachment } from "../src/services/EmailImportService.js";
import { ImportReviewService } from "../src/services/ImportReviewService.js";
import { OfferService } from "../src/services/OfferService.js";
import { PublicSeoService } from "../src/services/PublicSeoService.js";

after(async () => pool.end());

function xlsxAttachment(article, cost, suffix) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Артикул", "Название", "Количество", "Цена", "Розница", "Себестоимость"],
    [article, `EMAIL cost test ${article}`, 2, 100, 150, cost],
  ]), "Прайс");
  return {
    filename: `private-cost-email-${suffix}.xlsx`,
    content: Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
  };
}

async function importedOffer(article) {
  const result = await pool.query(`
    SELECT p.id AS product_id, po.id AS offer_id, po.quantity,
           po.purchase_price, pic.unit_cost
    FROM products p
    JOIN product_offers po ON po.product_id = p.id AND po.warehouse_id = 1
    LEFT JOIN product_offer_internal_costs pic ON pic.product_offer_id = po.id
    WHERE p.article_normalized = $1
  `, [article]);
  return result.rows[0] ?? null;
}

test("EMAIL XLSX saves and restores private cost with the production CSV profile and column F", async () => {
  assert.match(process.env.DB_NAME ?? "", /_test$/i);
  const suffix = `${Date.now()}${process.pid}`.slice(-10);
  const article = `TSTMAILA${suffix}`;
  const reviewedArticle = `TSTMAILR${suffix}`;
  const absentArticle = `TSTMAILX${suffix}`;
  const prefix = `private-cost-email-${suffix}`;
  const rules = await EmailImportRuleRepository.findActive();
  const initialSettings = rules.find((rule) => Number(rule.warehouse_supplier_import_id) === 2);
  assert.ok(initialSettings, "isolated fixture needs active EMAIL rule 2");
  assert.equal(initialSettings.warehouse_id, 1);
  assert.equal(initialSettings.warehouse_type, "OWN");
  assert.equal(initialSettings.supplier_type, "OWN");
  assert.equal(initialSettings.pricing_model, "OWN_DUAL_PRICE");
  const profileId = Number(initialSettings.warehouse_supplier_import_id);
  const original = await pool.query(`
    SELECT wsi.new_products_mode, wsi.internal_purchase_price_column,
           wsi.is_active, wsi.email_auto_import_enabled,
           sis.file_type, sis.import_method, sis.price_column, sis.retail_price_column
    FROM warehouse_supplier_imports wsi
    JOIN supplier_import_settings sis ON sis.id = wsi.supplier_import_settings_id
    WHERE wsi.id = $1
  `, [profileId]);
  assert.equal(original.rows[0]?.is_active, true);
  assert.equal(original.rows[0]?.email_auto_import_enabled, true);
  assert.equal(original.rows[0]?.file_type, "CSV");
  assert.equal(original.rows[0]?.import_method, "EMAIL");
  assert.equal(original.rows[0]?.price_column, 4);
  assert.equal(original.rows[0]?.retail_price_column, 5);

  try {
    await pool.query(`
      UPDATE warehouse_supplier_imports
      SET new_products_mode = 'AUTO', internal_purchase_price_column = 6
      WHERE id = $1
    `, [profileId]);
    const settings = (await EmailImportRuleRepository.findActive())
      .find((rule) => Number(rule.warehouse_supplier_import_id) === profileId);
    assert.ok(settings);
    assert.equal(settings.internal_purchase_price_column, 6);
    const first = await importAttachment(settings, xlsxAttachment(article, 31.123456, `${suffix}-first`));
    assert.equal(first.result.errors, 0);
    assert.equal(first.result.successRows, 1);
    assert.equal(first.result.newProducts, 1);
    assert.equal(Number((await importedOffer(article))?.unit_cost), 31.123456);
    assert.equal(Number((await importedOffer(article))?.purchase_price), 100);
    assert.equal(Number((await importedOffer(article))?.quantity), 2);
    const snapshot = await pool.query(`
      SELECT file_type, import_method, private_cost_column
      FROM imports WHERE id = $1
    `, [first.result.importId]);
    assert.equal(snapshot.rows[0]?.file_type, "XLSX");
    assert.equal(snapshot.rows[0]?.import_method, "EMAIL");
    assert.equal(snapshot.rows[0]?.private_cost_column, 6);

    const offerId = Number((await importedOffer(article)).offer_id);
    await pool.query(`DELETE FROM product_offer_internal_costs WHERE product_offer_id = $1`, [offerId]);
    assert.equal((await importedOffer(article)).unit_cost, null);
    const restored = await importAttachment(settings, xlsxAttachment(article, 32.234567, `${suffix}-restore`));
    assert.equal(restored.result.errors, 0);
    assert.equal(restored.result.newProducts, 0);
    assert.equal(Number((await importedOffer(article))?.unit_cost), 32.234567);
    assert.equal(Number((await importedOffer(article))?.offer_id), offerId);

    const updated = await importAttachment(settings, xlsxAttachment(article, 33.345678, `${suffix}-update`));
    assert.equal(updated.result.errors, 0);
    assert.equal(Number((await importedOffer(article))?.unit_cost), 33.345678);
    assert.equal(Number((await importedOffer(article))?.purchase_price), 100);
    assert.equal(Number((await importedOffer(article))?.quantity), 2);
    const publicOffers = await OfferService.getOffersByProductId(Number((await importedOffer(article)).product_id), null, "uk");
    const publicSeo = await PublicSeoService.getProduct({ article, locale: "uk" });
    for (const value of [publicOffers, publicSeo]) {
      const serialized = JSON.stringify(value);
      assert.doesNotMatch(serialized, /unit_cost|unitCost|internalUnitCost|internal_cost|33\.345678/i);
    }
    const server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    try {
      const port = server.address().port;
      for (const path of [
        `/api/seo/products/${article}?locale=uk`,
        `/api/search/product?article=${article}&locale=uk`,
      ]) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        assert.equal(response.status, 200, path);
        const body = await response.text();
        assert.doesNotMatch(body, /unit_cost|unitCost|internalUnitCost|internal_cost|33\.345678/i, path);
      }
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    const csv = await importAttachment(settings, {
      filename: `${prefix}-without-private-column.csv`,
      content: Buffer.from(`Артикул;Название;Количество;Цена;Розница\n${article};EMAIL cost test ${article};2;100;150\n`),
    });
    assert.equal(csv.result.errors, 0);
    assert.equal(Number((await importedOffer(article))?.unit_cost), 33.345678);
    const csvSnapshot = await pool.query(`
      SELECT file_type, private_cost_column FROM imports WHERE id = $1
    `, [csv.result.importId]);
    assert.equal(csvSnapshot.rows[0]?.file_type, "CSV");
    assert.equal(csvSnapshot.rows[0]?.private_cost_column, null);

    await assert.rejects(
      importAttachment(settings, xlsxAttachment(absentArticle, null, `${suffix}-missing`)),
      /реальная входящая цена/,
    );
    assert.equal(await importedOffer(absentArticle), null);
    assert.equal(Number((await importedOffer(article))?.unit_cost), 33.345678);

    await pool.query(`UPDATE warehouse_supplier_imports SET new_products_mode = 'REVIEW' WHERE id = $1`, [profileId]);
    const reviewImport = await importAttachment(settings, xlsxAttachment(reviewedArticle, 41.456789, `${suffix}-review`));
    assert.equal(reviewImport.result.pendingNewProducts, 1);
    assert.equal(await importedOffer(reviewedArticle), null);
    const pending = await ImportReviewService.getPending({ warehouseId: 1 });
    const review = pending.items.find((item) => item.articleNormalized === reviewedArticle);
    assert.ok(review);
    const approved = await ImportReviewService.approve(review.id);
    assert.equal(approved.status, "APPROVED");
    assert.equal(Number((await importedOffer(reviewedArticle))?.unit_cost), 41.456789);
  } finally {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(`
        UPDATE warehouse_supplier_imports
        SET new_products_mode = $2, internal_purchase_price_column = $3
        WHERE id = $1
      `, [profileId, original.rows[0].new_products_mode, original.rows[0].internal_purchase_price_column]);
      const articles = [article, reviewedArticle, absentArticle];
      await db.query(`DELETE FROM import_new_products WHERE article_normalized = ANY($1::text[])`, [articles]);
      await db.query(`
        DELETE FROM price_history WHERE product_offer_id IN (
          SELECT po.id FROM product_offers po JOIN products p ON p.id = po.product_id
          WHERE p.article_normalized = ANY($1::text[]) AND po.warehouse_id = 1
        )
      `, [articles]);
      await db.query(`DELETE FROM imports WHERE file_name LIKE $1`, [`${prefix}-%`]);
      await db.query(`
        DELETE FROM product_offers WHERE product_id IN (
          SELECT id FROM products WHERE article_normalized = ANY($1::text[])
        ) AND warehouse_id = 1
      `, [articles]);
      await db.query(`DELETE FROM products WHERE article_normalized = ANY($1::text[])`, [articles]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
});
