import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { SupplierService } from "../src/services/SupplierService.js";
import { WarehouseService } from "../src/services/WarehouseService.js";
import { BrandAdminService } from "../src/services/BrandAdminService.js";
import { WarehouseImportProfileService } from "../src/services/WarehouseImportProfileService.js";
import { ImportService } from "../src/services/ImportService.js";

after(async () => {
  await pool.end();
});

test(
  "полностью заменяет прайс, сохраняет карточки и ошибки строк",
  async () => {
    const token = String(Date.now());

    let supplierId = null;
    let warehouseId = null;
    let brandId = null;
    let settingsId = null;
    let warehouseSupplierImportId = null;

    const articleA = `TEST${token}A`;
    const articleB = `TEST${token}B`;

    try {
      const supplier = await SupplierService.createSupplier({
        name: `AUTOHUB IMPORT TEST ${token}`,
        type: "PARTNER",
        warehousePriorityEnabled: false,
      });

      supplierId = Number(supplier.id);

      const warehouse = await WarehouseService.createWarehouse({
        supplierId,
        name: `AUTOHUB IMPORT WAREHOUSE ${token}`,
        city: "TEST",
        type: "SUPPLIER",
        deliveryDays: 1,
      });

      warehouseId = Number(warehouse.id);

      const brand = await BrandAdminService.createBrand({
        name: `AUTOHUB TEST BRAND ${token}`,
      });

      brandId = Number(brand.id);

      const savedProfile =
        await WarehouseImportProfileService.saveProfile(
          warehouseId,
          {
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
          }
        );

      assert.ok(savedProfile.profile);

      settingsId = Number(
        savedProfile.profile.supplierImportSettingsId
      );

      warehouseSupplierImportId = Number(
        savedProfile.profile.id
      );

      const firstImport = await ImportService.importRows(
        {
          warehouseId,
          warehouseSupplierImportId,
          fileName: "test-first-price.csv",
          fileType: "CSV",
          importMethod: "MANUAL",
        },
        [
          {
            article: articleA,
            name: "Тестовая позиция A",
            price: 100,
            quantity: 5,
          },
          {
            article: articleB,
            name: "Тестовая позиция B",
            price: 200,
            quantity: 7,
          },
        ]
      );

      assert.equal(firstImport.successRows, 2);
      assert.equal(firstImport.errors, 0);
      assert.equal(firstImport.replacementApplied, true);

      const secondImport = await ImportService.importRows(
        {
          warehouseId,
          warehouseSupplierImportId,
          fileName: "test-second-price.csv",
          fileType: "CSV",
          importMethod: "MANUAL",
        },
        [
          {
            article: articleA,
            name: "Тестовая позиция A",
            price: 120,
            quantity: 3,
          },
          {
            article: "!!!",
            name: "Ошибочная строка",
            price: 300,
            quantity: 1,
          },
        ]
      );

      assert.equal(secondImport.successRows, 1);
      assert.equal(secondImport.errors, 1);
      assert.equal(secondImport.replacementApplied, true);
      assert.equal(secondImport.missingOffersDisabled, 1);

      const productsResult = await pool.query(
        `
          SELECT id, article_normalized
          FROM products
          WHERE brand_id = $1
            AND article_normalized = ANY($2::text[])
          ORDER BY article_normalized
        `,
        [brandId, [articleA, articleB]]
      );

      assert.equal(productsResult.rows.length, 2);

      const productA = productsResult.rows.find(
        (product) => product.article_normalized === articleA
      );

      const productB = productsResult.rows.find(
        (product) => product.article_normalized === articleB
      );

      assert.ok(productA);
      assert.ok(productB);

      const offersResult = await pool.query(
        `
          SELECT product_id, quantity, purchase_price, is_available
          FROM product_offers
          WHERE warehouse_id = $1
            AND product_id = ANY($2::integer[])
        `,
        [
          warehouseId,
          [Number(productA.id), Number(productB.id)],
        ]
      );

      const offerA = offersResult.rows.find(
        (offer) =>
          Number(offer.product_id) === Number(productA.id)
      );

      const offerB = offersResult.rows.find(
        (offer) =>
          Number(offer.product_id) === Number(productB.id)
      );

      assert.ok(offerA);
      assert.ok(offerB);

      assert.equal(Number(offerA.quantity), 3);
      assert.equal(Number(offerA.purchase_price), 120);
      assert.equal(offerA.is_available, true);

      assert.equal(Number(offerB.quantity), 0);
      assert.equal(offerB.is_available, false);

      const importResult = await pool.query(
        `
          SELECT status, success_rows, error_rows
          FROM imports
          WHERE id = $1
        `,
        [secondImport.importId]
      );

      assert.equal(
        importResult.rows[0].status,
        "COMPLETED_WITH_ERRORS"
      );
      assert.equal(
        Number(importResult.rows[0].success_rows),
        1
      );
      assert.equal(
        Number(importResult.rows[0].error_rows),
        1
      );

      const errorsResult = await pool.query(
        `
          SELECT article, status, error_message
          FROM import_rows
          WHERE import_id = $1
            AND status = 'ERROR'
        `,
        [secondImport.importId]
      );

      assert.equal(errorsResult.rows.length, 1);
      assert.equal(errorsResult.rows[0].article, "!!!");
      assert.match(
        errorsResult.rows[0].error_message,
        /нормализац/i
      );
    } finally {
      const db = await pool.connect();

      try {
        await db.query("BEGIN");

        if (warehouseId !== null) {
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
            "DELETE FROM imports WHERE warehouse_id = $1",
            [warehouseId]
          );

          await db.query(
            "DELETE FROM product_offers WHERE warehouse_id = $1",
            [warehouseId]
          );
        }

        if (brandId !== null) {
          await db.query(
            "DELETE FROM products WHERE brand_id = $1",
            [brandId]
          );
        }

        if (warehouseSupplierImportId !== null) {
          await db.query(
            `
              DELETE FROM warehouse_supplier_imports
              WHERE id = $1
            `,
            [warehouseSupplierImportId]
          );
        }

        if (settingsId !== null) {
          await db.query(
            `
              DELETE FROM supplier_import_settings
              WHERE id = $1
            `,
            [settingsId]
          );
        }

        if (warehouseId !== null) {
          await db.query(
            "DELETE FROM warehouses WHERE id = $1",
            [warehouseId]
          );
        }

        if (supplierId !== null) {
          await db.query(
            "DELETE FROM suppliers WHERE id = $1",
            [supplierId]
          );
        }

        if (brandId !== null) {
          await db.query(
            "DELETE FROM brand_aliases WHERE brand_id = $1",
            [brandId]
          );

          await db.query(
            "DELETE FROM brands WHERE id = $1",
            [brandId]
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
  }
);
