import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { pool } from "../src/config/db.js";
import { SupplierService } from "../src/services/SupplierService.js";
import { WarehouseService } from "../src/services/WarehouseService.js";
import { BrandAdminService } from "../src/services/BrandAdminService.js";
import { WarehouseImportProfileService } from "../src/services/WarehouseImportProfileService.js";
import { ImportService } from "../src/services/ImportService.js";
import { adminImportRouter } from "../src/routes/admin-import.routes.js";

after(async () => {
  await pool.end();
});

test(
  "полностью заменяет прайс и выдаёт сохранённые ошибки через API",
  async () => {
    const token = String(Date.now());

    let supplierId = null;
    let warehouseId = null;
    let brandId = null;
    let settingsId = null;
    let warehouseSupplierImportId = null;

    const articleAInput = `Н${token}С`;
    const articleA = `H${token}C`;
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
            article: articleAInput,
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
            article: articleAInput,
            name: "Тестовая позиция A",
            price: 120,
            quantity: 3,
          },
          {
            rowNumber: 2,
            rawData: [
              "!!!",
              "Ошибочная строка",
              "300",
              "1",
            ],
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
          SELECT
            article,
            status,
            error_message,
            source_row_number,
            raw_data
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

      assert.equal(
        Number(
          errorsResult.rows[0]
            .source_row_number
        ),
        2
      );

      assert.deepEqual(
        errorsResult.rows[0].raw_data,
        [
          "!!!",
          "Ошибочная строка",
          "300",
          "1",
        ]
      );


      const testApp = express();

      testApp.use(
        "/api/admin/import",
        adminImportRouter
      );


      const server =
        await new Promise(
          (resolve) => {
            const nextServer =
              testApp.listen(
                0,
                "127.0.0.1",
                () => {
                  resolve(nextServer);
                }
              );
          }
        );

      try {
        const address =
          server.address();

        assert.ok(
          address &&
          typeof address === "object"
        );

        const apiResponse =
          await fetch(
            `http://127.0.0.1:` +
            `${address.port}` +
            `/api/admin/import/` +
            `${secondImport.importId}` +
            `/errors?warehouseId=` +
            `${warehouseId}`
          );

        assert.equal(
          apiResponse.status,
          200
        );

        const apiBody =
          await apiResponse.json();

        assert.equal(
          apiBody.success,
          true
        );

        assert.equal(
          apiBody.importId,
          secondImport.importId
        );

        assert.equal(
          apiBody.warehouseId,
          warehouseId
        );

        assert.equal(
          apiBody.count,
          1
        );

        assert.equal(
          apiBody.errors.length,
          1
        );

        assert.equal(
          apiBody.errors[0]
            .sourceRowNumber,
          2
        );

        assert.equal(
          apiBody.errors[0].article,
          "!!!"
        );

        assert.equal(
          apiBody.errors[0].name,
          "Ошибочная строка"
        );

        assert.equal(
          Number(
            apiBody.errors[0].price
          ),
          300
        );

        assert.equal(
          Number(
            apiBody.errors[0].quantity
          ),
          1
        );

        assert.match(
          apiBody.errors[0]
            .errorMessage,
          /нормализац/i
        );

        assert.deepEqual(
          apiBody.errors[0].rawData,
          [
            "!!!",
            "Ошибочная строка",
            "300",
            "1",
          ]
        );



        const historyResponse =
          await fetch(
            `http://127.0.0.1:` +
            `${address.port}` +
            `/api/admin/import/history?` +
            `warehouseId=${warehouseId}` +
            `&limit=10`
          );

        assert.equal(
          historyResponse.status,
          200
        );

        const historyBody =
          await historyResponse.json();

        assert.equal(
          historyBody.success,
          true
        );

        assert.equal(
          historyBody.warehouseId,
          warehouseId
        );

        assert.equal(
          historyBody.count,
          2
        );

        assert.equal(
          historyBody.imports.length,
          2
        );

        assert.equal(
          historyBody.imports[0].id,
          secondImport.importId
        );

        assert.equal(
          historyBody.imports[0].status,
          "COMPLETED_WITH_ERRORS"
        );

        assert.equal(
          historyBody.imports[0].successRows,
          1
        );

        assert.equal(
          historyBody.imports[0].errorRows,
          1
        );

        assert.equal(
          historyBody.imports[0].fileName,
          "test-second-price.csv"
        );

        assert.equal(
          historyBody.imports[1].id,
          firstImport.importId
        );

        assert.equal(
          historyBody.imports[1].status,
          "COMPLETED"
        );

        assert.equal(
          historyBody.imports[1].successRows,
          2
        );

        assert.equal(
          historyBody.imports[1].errorRows,
          0
        );


        const foreignResponse =
          await fetch(
            `http://127.0.0.1:` +
            `${address.port}` +
            `/api/admin/import/` +
            `${secondImport.importId}` +
            `/errors?warehouseId=` +
            `${warehouseId + 1000000}`
          );

        assert.equal(
          foreignResponse.status,
          200
        );

        const foreignBody =
          await foreignResponse.json();

        assert.equal(
          foreignBody.count,
          0
        );
      } finally {
        await new Promise(
          (resolve, reject) => {
            server.close(
              (error) => {
                if (error) {
                  reject(error);
                  return;
                }

                resolve();
              }
            );
          }
        );
      }
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
