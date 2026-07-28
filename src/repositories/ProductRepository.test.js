import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../config/db.js";
import { ProductRepository } from "./ProductRepository.js";

import {
  SEARCH_FIXTURE,
} from "../../tests/helpers/search-fixture.js";


after(async () => {
  await pool.end();
});


test(
  "находит товар по нормализованному артикулу",
  async () => {
    const product =
      await ProductRepository
        .findByNormalizedArticle(
          SEARCH_FIXTURE
            .originalNormalized
        );

    assert.ok(product);

    assert.equal(
      product.article,
      SEARCH_FIXTURE.originalArticle
    );

    assert.equal(
      product.manufacturer,
      "Mercedes-Benz"
    );
  }
);


test(
  "находит предложения товара",
  async () => {
    const product =
      await ProductRepository
        .findByNormalizedArticle(
          SEARCH_FIXTURE
            .analogNormalized
        );

    assert.ok(product);

    const offers =
      await ProductRepository
        .findOffersByProductId(
          product.id
        );

    assert.ok(
      Array.isArray(offers)
    );

    assert.equal(
      offers.length,
      1
    );

    assert.equal(
      offers[0].quantity,
      "4.00"
    );

    assert.equal(
      offers[0].retail_price,
      "550.00"
    );

    assert.equal(
      offers[0].source_type,
      "OWN_STOCK"
    );

    assert.equal(
      offers[0].warehouse_name,
      SEARCH_FIXTURE.warehouseName
    );
  }
);


test(
  "возвращает эффективную ручную цену предложения",
  async () => {
    const product =
      await ProductRepository
        .findByNormalizedArticle(
          SEARCH_FIXTURE
            .analogNormalized
        );

    assert.ok(product);

    const offers =
      await ProductRepository
        .findOffersByProductId(
          product.id
        );

    assert.equal(
      offers.length,
      1
    );

    const offer =
      await ProductRepository
        .findOfferById(
          offers[0].id
        );

    assert.ok(offer);

    assert.equal(
      offer.retailPrice,
      SEARCH_FIXTURE.manualRetailPrice
    );

    assert.equal(
      offer.isAvailable,
      true
    );
  }
);
