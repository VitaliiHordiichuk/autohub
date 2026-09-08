import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "../src/config/db.js";
import { SupplierService } from "../src/services/SupplierService.js";
import { WarehouseService } from "../src/services/WarehouseService.js";
import { BrandAdminService } from "../src/services/BrandAdminService.js";
import { WarehouseImportProfileService } from "../src/services/WarehouseImportProfileService.js";
import { ImportService } from "../src/services/ImportService.js";
import { AdminWarehouseOfferService } from "../src/services/AdminWarehouseOfferService.js";

after(() => pool.end());

test("price import handles zero/tiny old prices without overflowing history or rejecting valid rows", async () => {
  assert.match(process.env.DB_NAME || "", /_test$/, "Run only on an isolated test database");
  const token = randomUUID().replaceAll("-", "").toUpperCase();
  let supplierId, warehouseId, brandId, profile;
  const cases = [
    { suffix: "ZERO", old: 0, price: 7204.5, retailPrice: 9005.63, percent: null, status: "IMPORTED" },
    { suffix: "TINY", old: 0.01, price: 157585.5, retailPrice: 196981.88, percent: 999999.99, status: "PRICE_RISE_ALERT" },
    { suffix: "NORMAL", old: 100, price: 125, retailPrice: 156.25, percent: 25, status: "IMPORTED" },
    { suffix: "DROP", old: 100, price: 0, retailPrice: 0, percent: -100, status: "PRICE_DROP_ALERT" },
    { suffix: "SAME", old: 0, price: 0, retailPrice: 0, percent: null, status: "IMPORTED" },
    { suffix: "NULL", old: null, price: 625.05, retailPrice: 781.31, percent: null, status: "IMPORTED" },
    { suffix: "LIMIT", old: 0.01, price: 79999999.99, retailPrice: 99999999.99, percent: 999999.99, status: "PRICE_RISE_ALERT" },
  ].map(item => ({ ...item, article: `PRICEHISTORY${token}${item.suffix}`, name: `Test price ${item.suffix}` }));

  try {
    const supplier = await SupplierService.createSupplier({ name: `PRICE HISTORY ${token}`, type: "PARTNER", warehousePriorityEnabled: false });
    supplierId = Number(supplier.id);
    const warehouse = await WarehouseService.createWarehouse({ supplierId, name: `PRICE HISTORY ${token}`, city: "TEST", type: "SUPPLIER", deliveryDays: 1 });
    warehouseId = Number(warehouse.id);
    const brand = await BrandAdminService.createBrand({ name: `PRICE HISTORY ${token}` });
    brandId = Number(brand.id);
    await pool.query("UPDATE warehouses SET pricing_model='OWN_DUAL_PRICE', minimum_markup_percent=10 WHERE id=$1", [warehouseId]);
    ({ profile } = await WarehouseImportProfileService.saveProfile(warehouseId, {
      fileType: "XLSX", brandMode: "FIXED", fixedBrandId: brandId,
      articleColumn: 1, nameColumn: 2, quantityColumn: 3, priceColumn: 4, retailPriceColumn: 5,
      startRow: 2, isActive: true, emailAutoImportEnabled: false, newProductsMode: "AUTO",
      priceDropThreshold: 30, priceRiseThreshold: 40,
    }));
    const context = { warehouseId, warehouseSupplierImportId: Number(profile.id), fileName: "price-history-regression.xlsx", fileType: "XLSX", importMethod: "MANUAL" };
    // The initial import creates dedicated offers, never existing customer stock.
    const initial = await ImportService.importRows(context, cases.map(item => ({
      article: item.article, name: item.name, price: item.old ?? 0,
      retailPrice: Number(((item.old ?? 0) * 1.25).toFixed(2)), quantity: 1,
    })));
    assert.equal(initial.errors, 0);
    assert.equal(initial.successRows, cases.length);
    await pool.query(`UPDATE product_offers SET purchase_price=NULL WHERE warehouse_id=$1
      AND product_id IN (SELECT id FROM products WHERE brand_id=$2 AND article=$3)`, [warehouseId, brandId, cases[5].article]);
    await pool.query(`UPDATE product_offers SET price_mode='MANUAL', manual_retail_price=11111 WHERE warehouse_id=$1
      AND product_id IN (SELECT id FROM products WHERE brand_id=$2 AND article=$3)`, [warehouseId, brandId, cases[0].article]);

    const result = await ImportService.importRows(context, cases.map((item, index) => ({
      article: item.article, name: item.name, quantity: 3, price: item.price, retailPrice: item.retailPrice,
      rowNumber: index + 2, rawData: [item.article, item.name, 3, item.price, item.retailPrice],
    })));
    const report = await pool.query("SELECT * FROM import_rows WHERE import_id=$1", [result.importId]);
    assert.equal(result.errors, 0, JSON.stringify(report.rows.filter(row => row.status === "ERROR").map(row => ({ article: row.article, error: row.error_message }))));
    assert.equal(result.successRows, cases.length);
    assert.equal(result.priceChanges, 5);
    assert.equal(result.priceRises, 2);
    assert.equal(result.priceDrops, 1);
    assert.equal(result.missingOffersDisabled, 0);

    const offers = (await pool.query(`SELECT po.*, p.article FROM product_offers po
      JOIN products p ON p.id=po.product_id WHERE po.warehouse_id=$1`, [warehouseId])).rows;
    const history = (await pool.query(`SELECT ph.* FROM price_history ph JOIN product_offers po
      ON po.id=ph.product_offer_id WHERE po.warehouse_id=$1`, [warehouseId])).rows;
    assert.equal(history.length, 5);
    for (const item of cases) {
      const offer = offers.find(row => row.article === item.article);
      assert.ok(offer);
      assert.equal(Number(offer.purchase_price), item.price);
      assert.equal(Number(offer.retail_price), item.retailPrice);
      assert.equal(Number(offer.quantity), 3);
      const row = report.rows.find(row => row.article === item.article);
      assert.equal(row.status, item.status);
      assert.equal(row.error_message, null);
      assert.equal(row.change_percent === null ? null : Number(row.change_percent), item.percent);
      const change = history.find(row => Number(row.product_offer_id) === Number(offer.id));
      if (item.old !== null && item.old !== item.price) {
        assert.ok(change, item.suffix);
        assert.equal(Number(change.old_price), item.old);
        assert.equal(Number(change.new_price), item.price);
        assert.equal(change.change_percent === null ? null : Number(change.change_percent), item.percent);
      } else assert.equal(change, undefined);
    }
    const manualOffer = offers.find(row => row.article === cases[0].article);
    assert.equal(manualOffer.price_mode, "MANUAL");
    assert.equal(Number(manualOffer.manual_retail_price), 11111);
    const repeated = await ImportService.importRows(context, cases.map(item => ({ ...item, quantity: 3 })));
    assert.equal(repeated.errors, 0);
    assert.equal(repeated.priceChanges, 0);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM price_history ph JOIN product_offers po
      ON po.id=ph.product_offer_id WHERE po.warehouse_id=$1`, [warehouseId])).rows[0].count), 5);

    // Manual corrections/reset write to the same numeric history field.
    const tinyOffer = offers.find(row => row.article === cases[1].article);
    const manualContext = { warehouseId, offerId: Number(tinyOffer.id), changedBy: null };
    await AdminWarehouseOfferService.setManualPrice({ ...manualContext, price: 0.01 });
    const manual = await AdminWarehouseOfferService.setManualPrice({ ...manualContext, price: 7204.5 });
    assert.equal(Number(manual.history.change_percent), 999999.99);
    await AdminWarehouseOfferService.setManualPrice({ ...manualContext, price: 0.01 });
    const reset = await AdminWarehouseOfferService.resetAutomaticPrice(manualContext);
    assert.equal(Number(reset.history.change_percent), 999999.99);
  } finally {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      if (warehouseId) {
        await db.query("DELETE FROM price_history WHERE product_offer_id IN (SELECT id FROM product_offers WHERE warehouse_id=$1)", [warehouseId]);
        await db.query("DELETE FROM imports WHERE warehouse_id=$1", [warehouseId]);
        await db.query("DELETE FROM product_offers WHERE warehouse_id=$1", [warehouseId]);
      }
      if (brandId) await db.query("DELETE FROM products WHERE brand_id=$1", [brandId]);
      if (profile) {
        await db.query("DELETE FROM warehouse_supplier_imports WHERE id=$1", [profile.id]);
        await db.query("DELETE FROM supplier_import_settings WHERE id=$1", [profile.supplierImportSettingsId]);
      }
      if (warehouseId) await db.query("DELETE FROM warehouses WHERE id=$1", [warehouseId]);
      if (supplierId) await db.query("DELETE FROM suppliers WHERE id=$1", [supplierId]);
      if (brandId) {
        await db.query("DELETE FROM brand_aliases WHERE brand_id=$1", [brandId]);
        await db.query("DELETE FROM brands WHERE id=$1", [brandId]);
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally { db.release(); }
  }
});
