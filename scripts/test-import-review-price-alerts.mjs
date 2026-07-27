import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { SupplierService } from "../src/services/SupplierService.js";
import { WarehouseService } from "../src/services/WarehouseService.js";
import { BrandAdminService } from "../src/services/BrandAdminService.js";
import { WarehouseImportProfileService } from "../src/services/WarehouseImportProfileService.js";
import { ImportService } from "../src/services/ImportService.js";
import { ImportReviewService } from "../src/services/ImportReviewService.js";

const token = String(Date.now());

let supplierId = null;
let warehouseId = null;
let brandId = null;
let supplierImportSettingsId = null;
let warehouseSupplierImportId = null;

const articleReview = `REV${token}`;
const articleAuto = `AUTO${token}`;
const articleIgnore = `IGN${token}`;

function profilePayload(newProductsMode) {
  return {
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
    priceDropThreshold: 30,
    priceRiseThreshold: 40,
  };
}

async function cleanup() {
  const db = await pool.connect();

  try {
    await db.query("BEGIN");

    if (warehouseId) {
      await db.query(
        `
          DELETE FROM price_history
          WHERE product_offer_id IN (
            SELECT id
            FROM product_offers
            WHERE warehouse_id = $1
          )
        `,
        [warehouseId]
      );

      await db.query(
        `DELETE FROM import_new_products WHERE warehouse_id = $1`,
        [warehouseId]
      );

      await db.query(
        `DELETE FROM imports WHERE warehouse_id = $1`,
        [warehouseId]
      );

      await db.query(
        `DELETE FROM product_offers WHERE warehouse_id = $1`,
        [warehouseId]
      );

      await db.query(
        `DELETE FROM warehouse_supplier_imports WHERE warehouse_id = $1`,
        [warehouseId]
      );
    }

    if (supplierImportSettingsId) {
      await db.query(
        `DELETE FROM supplier_import_settings WHERE id = $1`,
        [supplierImportSettingsId]
      );
    }

    if (brandId) {
      await db.query(
        `DELETE FROM products WHERE brand_id = $1`,
        [brandId]
      );

      await db.query(
        `DELETE FROM brands WHERE id = $1`,
        [brandId]
      );
    }

    if (warehouseId) {
      await db.query(
        `DELETE FROM warehouses WHERE id = $1`,
        [warehouseId]
      );
    }

    if (supplierId) {
      await db.query(
        `DELETE FROM suppliers WHERE id = $1`,
        [supplierId]
      );
    }

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

try {
  const supplier = await SupplierService.createSupplier({
    name: `AUTOHUB REVIEW TEST ${token}`,
    type: "PARTNER",
    warehousePriorityEnabled: false,
  });

  supplierId = Number(supplier.id);

  const warehouse = await WarehouseService.createWarehouse({
    supplierId,
    name: `AUTOHUB REVIEW WAREHOUSE ${token}`,
    city: "TEST",
    type: "SUPPLIER",
    deliveryDays: 1,
  });

  warehouseId = Number(warehouse.id);

  const brand = await BrandAdminService.createBrand({
    name: `AUTOHUB REVIEW BRAND ${token}`,
  });

  brandId = Number(brand.id);

  const reviewProfile =
    await WarehouseImportProfileService.saveProfile(
      warehouseId,
      profilePayload("REVIEW")
    );

  supplierImportSettingsId = Number(
    reviewProfile.profile.supplierImportSettingsId
  );

  warehouseSupplierImportId = Number(
    reviewProfile.profile.id
  );

  assert.equal(
    reviewProfile.profile.newProductsMode,
    "REVIEW"
  );

  const reviewImport = await ImportService.importRows(
    {
      warehouseId,
      warehouseSupplierImportId,
      fileName: "review.csv",
      fileType: "CSV",
      importMethod: "MANUAL",
    },
    [
      {
        article: articleReview,
        name: "Товар на проверку",
        price: 100,
        quantity: 5,
      },
    ]
  );

  assert.equal(reviewImport.pendingNewProducts, 1);
  assert.equal(reviewImport.created, 0);

  const productBeforeApproval = await pool.query(
    `
      SELECT id
      FROM products
      WHERE brand_id = $1
        AND article_normalized = $2
    `,
    [brandId, articleReview]
  );

  assert.equal(productBeforeApproval.rows.length, 0);

  const pending = await ImportReviewService.getPending({
    warehouseId,
    page: 1,
    pageSize: 20,
  });

  assert.equal(pending.items.length, 1);

  const approved = await ImportReviewService.approve(
    pending.items[0].id
  );

  assert.equal(approved.status, "APPROVED");
  assert.ok(approved.productOfferId);

  const dropImport = await ImportService.importRows(
    {
      warehouseId,
      warehouseSupplierImportId,
      fileName: "drop.csv",
      fileType: "CSV",
      importMethod: "EMAIL",
    },
    [
      {
        article: articleReview,
        name: "Товар на проверку",
        price: 50,
        quantity: 3,
      },
    ]
  );

  assert.equal(dropImport.priceChanges, 1);
  assert.equal(dropImport.priceDrops, 1);

  const dropRow = await pool.query(
    `
      SELECT
        status,
        old_price,
        new_price,
        change_percent
      FROM import_rows
      WHERE import_id = $1
      LIMIT 1
    `,
    [dropImport.importId]
  );

  assert.equal(
    dropRow.rows[0].status,
    "PRICE_DROP_ALERT"
  );
  assert.equal(Number(dropRow.rows[0].old_price), 100);
  assert.equal(Number(dropRow.rows[0].new_price), 50);
  assert.equal(Number(dropRow.rows[0].change_percent), -50);

  await WarehouseImportProfileService.saveProfile(
    warehouseId,
    profilePayload("AUTO")
  );

  const autoImport = await ImportService.importRows(
    {
      warehouseId,
      warehouseSupplierImportId,
      fileName: "auto.csv",
      fileType: "CSV",
      importMethod: "MANUAL",
    },
    [
      {
        article: articleReview,
        name: "Товар на проверку",
        price: 55,
        quantity: 3,
      },
      {
        article: articleAuto,
        name: "Автоматический товар",
        price: 200,
        quantity: 4,
      },
    ]
  );

  assert.equal(autoImport.created, 1);
  assert.equal(autoImport.pendingNewProducts, 0);

  const riseImport = await ImportService.importRows(
    {
      warehouseId,
      warehouseSupplierImportId,
      fileName: "rise.csv",
      fileType: "CSV",
      importMethod: "EMAIL",
    },
    [
      {
        article: articleReview,
        name: "Товар на проверку",
        price: 55,
        quantity: 3,
      },
      {
        article: articleAuto,
        name: "Автоматический товар",
        price: 400,
        quantity: 4,
      },
    ]
  );

  assert.equal(riseImport.priceRises, 1);

  const report = await ImportReviewService.getReport(
    riseImport.importId,
    warehouseId
  );

  assert.equal(report.priceRises.length, 1);
  assert.equal(
    report.priceRises[0].article,
    articleAuto
  );
  assert.equal(
    report.priceRises[0].changePercent,
    100
  );

  await WarehouseImportProfileService.saveProfile(
    warehouseId,
    profilePayload("IGNORE")
  );

  const ignoreImport = await ImportService.importRows(
    {
      warehouseId,
      warehouseSupplierImportId,
      fileName: "ignore.csv",
      fileType: "CSV",
      importMethod: "MANUAL",
    },
    [
      {
        article: articleReview,
        name: "Товар на проверку",
        price: 55,
        quantity: 3,
      },
      {
        article: articleAuto,
        name: "Автоматический товар",
        price: 400,
        quantity: 4,
      },
      {
        article: articleIgnore,
        name: "Игнорируемый товар",
        price: 100,
        quantity: 2,
      },
    ]
  );

  assert.equal(ignoreImport.ignoredNewProducts, 1);

  const ignoredProduct = await pool.query(
    `
      SELECT id
      FROM products
      WHERE brand_id = $1
        AND article_normalized = $2
    `,
    [brandId, articleIgnore]
  );

  assert.equal(ignoredProduct.rows.length, 0);

  console.log(
    "Проверка новых товаров и отчёта цен: OK"
  );
} finally {
  try {
    await cleanup();
  } finally {
    await pool.end();
  }
}
