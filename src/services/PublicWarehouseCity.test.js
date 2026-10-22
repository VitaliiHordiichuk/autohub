import test from "node:test";
import assert from "node:assert/strict";

import { presentOffers } from "./OfferService.js";
import { mapPublicOffer } from "./PublicSeoService.js";
import { publicCatalogOffer } from "./PublicCatalogService.js";
import { PublicSearchPresenterService } from "./PublicSearchPresenterService.js";
import { pool } from "../config/db.js";

function rawOffer(overrides = {}) {
  return {
    id: 1,
    product_id: 2,
    warehouse_id: 3,
    source_type: "OWN_STOCK",
    warehouse_type: "OWN",
    supplier_type: "OWN",
    warehouse_city: " Харків ",
    warehouse_name: "Internal warehouse",
    supplier_name: "Internal supplier",
    quantity: 2,
    stock_quantity: 2,
    retail_price: 100,
    minimum_sale_price: 100,
    is_available: true,
    is_hidden: false,
    delivery_days: 0,
    ...overrides,
  };
}

test("only the actual own warehouse city enters the public offer", () => {
  const own = presentOffers([rawOffer()])[0];
  assert.equal(own.sourceType, "OWN_STOCK");
  assert.equal(own.warehouseCity, "Харків");
  const publicOwn = mapPublicOffer(own);
  assert.equal(publicOwn.sourceType, "OWN_STOCK");
  assert.equal(publicOwn.warehouseCity, "Харків");
  assert.equal(JSON.stringify(publicOwn).includes("Internal supplier"), false);
  assert.equal(JSON.stringify(publicOwn).includes("Internal warehouse"), false);
  const catalogOwn = publicCatalogOffer(own);
  assert.equal(catalogOwn.warehouseCity, "Харків");
  assert.equal(catalogOwn.supplier, undefined);
  assert.equal(catalogOwn.warehouse, undefined);

  const withoutCity = presentOffers([rawOffer({ warehouse_city: "  " })])[0];
  assert.equal(mapPublicOffer(withoutCity).warehouseCity, null);

  const partner = presentOffers([rawOffer({
    source_type: "SUPPLIER",
    warehouse_type: "SUPPLIER",
    supplier_type: "PARTNER",
  })])[0];
  assert.equal(partner.sourceType, "SUPPLIER");
  assert.equal(partner.warehouseCity, null);
  assert.equal(mapPublicOffer(partner).warehouseCity, null);
  assert.equal(publicCatalogOffer(partner).warehouseCity, null);
});

test("article search keeps warehouse data public while hiding supplier identities", async () => {
  const originalQuery = pool.query;
  pool.query = async (sql) => ({
    rows: String(sql).includes("FROM site_languages") && !String(sql).includes("FROM products p")
      ? [{ code: "uk" }]
      : [{ id: 2, public_name: "Тестовий товар", image_urls: [], image_variants: [] }],
  });
  const own = presentOffers([rawOffer()])[0];
  const partner = presentOffers([rawOffer({
    id: 4,
    source_type: "SUPPLIER",
    warehouse_type: "SUPPLIER",
    supplier_type: "PARTNER",
  })])[0];
  try {
    const result = await PublicSearchPresenterService.present({
      requestedLocale: "uk",
      family: [],
      productCard: {
        product: { id: 2, article: "TEST2", name: "Тестовий товар" },
        offers: [own, partner],
        analogs: [],
        replacements: [],
      },
    });
    const [publicOwn, publicPartner] = result.productCard.offers;
    assert.equal(publicOwn.sourceType, "OWN_STOCK");
    assert.equal(publicOwn.warehouseCity, "Харків");
    assert.equal(publicPartner.sourceType, "SUPPLIER");
    assert.equal(publicPartner.warehouseCity, null);
    assert.equal(publicOwn.sourceDetails, undefined);
    assert.equal(publicPartner.sourceDetails, undefined);
    assert.equal(JSON.stringify(result).includes("Internal supplier"), false);
    assert.equal(JSON.stringify(result).includes("Internal warehouse"), false);
  } finally {
    pool.query = originalQuery;
  }
});
