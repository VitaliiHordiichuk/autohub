import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../config/db.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { OfferService } from "./OfferService.js";

import {
  SEARCH_FIXTURE,
} from "../../tests/helpers/search-fixture.js";


after(async () => {
  await pool.end();
});


test(
  "возвращает подготовленные предложения товара",
  async () => {
    const product =
      await ProductRepository
        .findByNormalizedArticle(
          SEARCH_FIXTURE
            .analogNormalized
        );

    assert.ok(product);

    const offers =
      await OfferService
        .getOffersByProductId(
          product.id
        );

    assert.ok(
      Array.isArray(offers)
    );

    assert.equal(
      offers.length,
      1
    );

    const offer = offers[0];

    const databaseResult =
      await pool.query(
        `
          SELECT
            po.product_id,
            po.quantity,
            po.purchase_price,

            CASE
              WHEN po.price_mode = 'MANUAL'
                AND po.manual_retail_price IS NOT NULL
              THEN po.manual_retail_price
              ELSE po.retail_price
            END AS retail_price,

            po.delivery_days,
            po.is_available,
            w.name AS warehouse_name,
            w.city AS warehouse_city,

            COALESCE(
              po.supplier_id,
              w.supplier_id
            ) AS effective_supplier_id,

            s.name AS supplier_name,
            s.type AS supplier_type

          FROM product_offers AS po

          LEFT JOIN warehouses AS w
            ON w.id = po.warehouse_id

          LEFT JOIN suppliers AS s
            ON s.id = COALESCE(
              po.supplier_id,
              w.supplier_id
            )

          WHERE po.id = $1

          LIMIT 1
        `,
        [offer.id]
      );

    const databaseOffer =
      databaseResult.rows[0];

    assert.ok(databaseOffer);

    const quantity =
      Number(
        databaseOffer.quantity
      );

    assert.equal(
      offer.productId,
      Number(
        databaseOffer.product_id
      )
    );

    assert.equal(
      offer.sourceType,
      "OWN_STOCK"
    );

    assert.equal(
      offer.quantity,
      quantity
    );

    assert.equal(
      offer.displayQuantity,
      quantity > 5
        ? ">5"
        : String(quantity)
    );

    assert.equal(
      Object.hasOwn(
        offer,
        "purchasePrice"
      ),
      false
    );

    assert.equal(
      offer.retailPrice,
      Number(
        databaseOffer.retail_price
      )
    );

    assert.equal(
      offer.deliveryDays,
      Number(
        databaseOffer.delivery_days
      )
    );

    assert.equal(
      offer.isAvailable,
      databaseOffer.is_available ===
        true
    );

    assert.equal(
      offer.availabilityText,
      "В наявності"
    );

    assert.ok(offer.warehouse);

    assert.equal(
      offer.warehouse.name,
      SEARCH_FIXTURE.warehouseName
    );

    assert.equal(
      offer.warehouse.city,
      databaseOffer.warehouse_city
    );

    assert.equal(
      offer.supplier?.name,
      SEARCH_FIXTURE.supplierName
    );

    assert.equal(
      offer.supplier?.type,
      "OWN"
    );
  }
);
