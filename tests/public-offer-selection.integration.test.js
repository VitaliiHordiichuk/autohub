import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { GoogleMerchantFeedService } from "../src/services/GoogleMerchantFeedService.js";
import { OfferService, selectPrimaryPublicOffer } from "../src/services/OfferService.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";
import {
  PublicSeoService,
  publicBrandSlug,
} from "../src/services/PublicSeoService.js";

const originalPublicTaxonomyFlag = process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";

after(async () => {
  if (originalPublicTaxonomyFlag === undefined) {
    delete process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
  } else {
    process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = originalPublicTaxonomyFlag;
  }
  await pool.end();
});


test("Product, Brand, Category and Merchant share one public primary offer", async () => {
  const suffix =
    `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const article = `A07${suffix}`.toUpperCase();
  const brandName = `A07 Brand ${suffix}`;
  const categorySlug = "brakes-discs";
  const imageUrl =
    `https://images.example.test/merchant/a07-${suffix}-1500.webp`;
  const ids = {
    brand: null,
    category: null,
    supplier: null,
    warehouses: [],
    product: null,
    offers: [],
  };

  try {
    const brand = await pool.query(`
      INSERT INTO brands(name, is_active)
      VALUES($1, TRUE)
      RETURNING id
    `, [brandName]);
    ids.brand = Number(brand.rows[0].id);

    const category = await pool.query(`
      SELECT id
      FROM customer_categories
      WHERE slug = $1
        AND status = 'ACTIVE'
        AND is_active = TRUE
      LIMIT 1
    `, [categorySlug]);
    assert.ok(category.rows[0]);
    ids.category = Number(category.rows[0].id);

    const supplier = await pool.query(`
      INSERT INTO suppliers(
        name, type, is_active,
        warehouse_priority_enabled
      )
      VALUES($1, 'PARTNER', TRUE, TRUE)
      RETURNING id
    `, [`A07 supplier ${suffix}`]);
    ids.supplier = Number(supplier.rows[0].id);

    for (const priority of [1, 2]) {
      const warehouse = await pool.query(`
        INSERT INTO warehouses(
          name, city, type, supplier_id,
          priority, is_active
        )
        VALUES($1, 'Kyiv', 'SUPPLIER', $2, $3, TRUE)
        RETURNING id
      `, [
        `A07 warehouse ${priority} ${suffix}`,
        ids.supplier,
        priority,
      ]);
      ids.warehouses.push(
        Number(warehouse.rows[0].id)
      );
    }

    const product = await pool.query(`
      INSERT INTO products(
        article, article_normalized, name,
        brand_id, is_active
      )
      VALUES($1, $1, $2, $3, TRUE)
      RETURNING id
    `, [article, `A07 selection fixture ${suffix}`, ids.brand]);
    ids.product = Number(product.rows[0].id);

    await pool.query(`
      INSERT INTO product_customer_categories(
        product_id, customer_category_id, is_primary,
        assignment_source, assignment_origin, confidence,
        approval_status, approved_at
      )
      VALUES($1, $2, TRUE, 'MANUAL', 'ADMIN', 'HIGH', 'MANUAL_APPROVED', NOW())
    `, [ids.product, ids.category]);

    await pool.query(`
      INSERT INTO product_images(
        product_id, url, source, priority,
        original_url, merchant_url_1500
      )
      VALUES($1, $2, 'TEST', 0, $2, $2)
    `, [ids.product, imageUrl]);

    const offers = await pool.query(`
      INSERT INTO product_offers(
        product_id, warehouse_id, quantity,
        purchase_price, retail_price, minimum_sale_price,
        delivery_days, is_available, source_type,
        price_mode, manual_retail_price, is_hidden,
        return_policy_override
      )
      VALUES
        ($1, $2, 2, 50, 0, 50, 1, TRUE, 'SUPPLIER',
          'AUTO', NULL, FALSE, 'NON_RETURNABLE'),
        ($1, $3, 2, 70, 150, 70, 2, TRUE, 'SUPPLIER',
          'AUTO', NULL, FALSE, 'RETURNABLE')
      RETURNING id, warehouse_id
    `, [
      ids.product,
      ids.warehouses[0],
      ids.warehouses[1],
    ]);
    const offerIdByWarehouse = new Map(
      offers.rows.map((row) => [
        Number(row.warehouse_id),
        Number(row.id),
      ])
    );
    const priorityOneOfferId =
      offerIdByWarehouse.get(ids.warehouses[0]);
    const priorityTwoOfferId =
      offerIdByWarehouse.get(ids.warehouses[1]);
    ids.offers.push(
      priorityOneOfferId,
      priorityTwoOfferId
    );

    async function channelSelection() {
      const storefrontOffers =
        await OfferService.getOffersByProductId(
          ids.product,
          null,
          "uk"
        );
      const storefront =
        selectPrimaryPublicOffer(
          storefrontOffers
        );
      const productSeo =
        await PublicSeoService.getProduct({
          article,
          locale: "uk",
        }, pool);
      assert.equal(productSeo.product.category.slug, categorySlug);
      assert.equal(productSeo.product.category.parent.slug, "brakes");
      const brandPage =
        await PublicSeoService.getBrand({
          slug: publicBrandSlug(
            brandName,
            ids.brand
          ),
          locale: "uk",
          page: 1,
        }, pool);
      const categoryPage =
        await PublicCatalogService.getCategoryProducts({
          slug: categorySlug,
          locale: "uk",
          query: article,
        });
      const merchant =
        (await GoogleMerchantFeedService.getItems(
          pool,
          { productIds: [ids.product] }
        ))[0];

      return {
        storefront,
        product: productSeo.offer,
        brand: brandPage.products[0].offer,
        category: categoryPage.products[0].offers[0],
        merchant,
      };
    }

    const fallback = await channelSelection();

    assert.equal(fallback.storefront.id, priorityTwoOfferId);
    assert.equal(fallback.product.id, priorityTwoOfferId);
    assert.equal(fallback.brand.id, priorityTwoOfferId);
    assert.equal(fallback.category.id, priorityTwoOfferId);
    assert.equal(fallback.merchant.price, "150.00 UAH");
    assert.deepEqual(fallback.merchant.returnPolicy, {
      policy: "RETURNABLE",
      source: "OFFER",
    });

    await pool.query(`
      UPDATE product_offers
      SET price_mode = 'MANUAL',
          manual_retail_price = 200
      WHERE id = $1
    `, [priorityOneOfferId]);

    const priority = await channelSelection();

    assert.equal(priority.storefront.id, priorityOneOfferId);
    assert.equal(priority.storefront.retailPrice, 200);
    assert.equal(priority.product.id, priorityOneOfferId);
    assert.equal(priority.product.price, 200);
    assert.equal(priority.brand.id, priorityOneOfferId);
    assert.equal(priority.brand.price, 200);
    assert.equal(priority.category.id, priorityOneOfferId);
    assert.equal(priority.category.retailPrice, 200);
    assert.equal(priority.merchant.price, "200.00 UAH");
    assert.deepEqual(priority.merchant.returnPolicy, {
      policy: "NON_RETURNABLE",
      source: "OFFER",
    });
  } finally {
    if (ids.product) {
      await pool.query(
        "DELETE FROM product_customer_categories WHERE product_id = $1",
        [ids.product]
      );
      await pool.query(
        "DELETE FROM product_images WHERE product_id = $1",
        [ids.product]
      );
      await pool.query(
        "DELETE FROM product_offers WHERE product_id = $1",
        [ids.product]
      );
      await pool.query(
        "DELETE FROM products WHERE id = $1",
        [ids.product]
      );
    }
    if (ids.warehouses.length) {
      await pool.query(
        "DELETE FROM warehouses WHERE id = ANY($1::integer[])",
        [ids.warehouses]
      );
    }
    if (ids.supplier) {
      await pool.query(
        "DELETE FROM suppliers WHERE id = $1",
        [ids.supplier]
      );
    }
    if (ids.brand) {
      await pool.query(
        "DELETE FROM brands WHERE id = $1",
        [ids.brand]
      );
    }
  }
});
