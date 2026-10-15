import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";
import { CustomerPricingService } from "../src/services/CustomerPricingService.js";

const previousFlag = process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = "true";

after(async () => {
  if (previousFlag === undefined) delete process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED;
  else process.env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED = previousFlag;
  await pool.end();
});

test("catalog price filters and pagination use the public priority-selected offer for every customer price tier", async () => {
  const db = await pool.connect();
  const marker = `PRICEFILTER${Date.now()}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
  await db.query("BEGIN");
  try {
    const category = await db.query(`
      SELECT id FROM customer_categories
      WHERE slug='engine' AND status='ACTIVE' AND is_active=TRUE
    `);
    assert.ok(category.rows[0]);
    const supplier = await db.query(`
      INSERT INTO suppliers(name,type,is_active,warehouse_priority_enabled)
      VALUES($1,'PARTNER',TRUE,TRUE) RETURNING id
    `, [`${marker} supplier`]);
    const supplierId = Number(supplier.rows[0].id);
    const warehouses = [];
    for (const priority of [1, 2]) {
      const warehouse = await db.query(`
        INSERT INTO warehouses(name,city,type,supplier_id,priority,is_active)
        VALUES($1,'Kyiv','SUPPLIER',$2,$3,TRUE) RETURNING id
      `, [`${marker} warehouse ${priority}`, supplierId, priority]);
      warehouses.push(Number(warehouse.rows[0].id));
    }
    const articles = [];
    const products = [];
    for (let index = 0; index < 26; index += 1) {
      const article = `${marker}${String(index).padStart(2, "0")}`;
      const product = await db.query(`
        INSERT INTO products(article,article_normalized,name,is_active)
        VALUES($1,$1,$2,TRUE) RETURNING id
      `, [article, `${marker} item ${String(index).padStart(2, "0")}`]);
      const productId = Number(product.rows[0].id);
      await db.query(`
        INSERT INTO product_customer_categories(product_id,customer_category_id,is_primary,
          assignment_source,assignment_origin,confidence,approval_status,approved_at)
        VALUES($1,$2,TRUE,'MANUAL','ADMIN','HIGH','MANUAL_APPROVED',NOW())
      `, [productId, category.rows[0].id]);
      articles.push(article);
      products.push(productId);
    }
    async function offer(index, price, minimum, extra = {}) {
      const result = await db.query(`
        INSERT INTO product_offers(product_id,warehouse_id,quantity,purchase_price,
          retail_price,minimum_sale_price,source_type,is_available,is_hidden,price_mode)
        VALUES($1,$2,$3,100,$4,$5,'SUPPLIER',$6,$7,'AUTO') RETURNING id
      `, [products[index], extra.warehouseId ?? null, extra.quantity ?? 1,
        price, minimum, extra.available ?? true, extra.hidden ?? false]);
      return Number(result.rows[0].id);
    }
    // A2226706200: 52,821.30 is raw stock in the second warehouse, while
    // priority selects the 61,581.37 public offer from the first warehouse.
    await offer(0, 61581.37, 56000, { warehouseId: warehouses[0] });
    await offer(0, 52821.30, 48000, { warehouseId: warehouses[1] });
    await offer(1, 54000, 50000);
    const reservedOfferId = await offer(2, 30000, 25000, { warehouseId: warehouses[0] });
    await offer(2, 70000, 65000, { warehouseId: warehouses[1] });
    const cart = await db.query("INSERT INTO carts DEFAULT VALUES RETURNING id");
    await db.query(`
      INSERT INTO stock_reservations(cart_id,product_offer_id,quantity,status,reserved_until)
      VALUES($1,$2,1,'ORDER_PENDING',NOW()+INTERVAL '10 minutes')
    `, [cart.rows[0].id, reservedOfferId]);
    await offer(3, 1, 1, { hidden: true });
    await offer(3, 58000, 54000);
    await offer(4, 1, 1, { available: false });
    await offer(4, 59000, 55000);
    for (let index = 5; index < 26; index += 1) {
      await offer(index, 80000 + index * 100, 70000 + index * 100);
    }

    const priceGroups = await db.query(`
      SELECT name,discount_percent,pricing_mode FROM price_groups ORDER BY id
    `);
    const contexts = [
      { priceGroupName: "Guest", discountPercent: 0, isVip: false },
      ...priceGroups.rows.map((group) => ({
        priceGroupName: group.name,
        discountPercent: Number(group.discount_percent),
        isVip: group.pricing_mode === "MINIMUM",
      })),
    ];
    assert.ok(contexts.some((context) => context.isVip), "VIP tier is covered");
    assert.ok(contexts.some((context) => !context.isVip && context.discountPercent >= 15),
      "wholesale tier is covered");
    for (const pricingContext of contexts) {
      const visiblePrice = CustomerPricingService.price({
        retailPrice: 61581.37, minimumSalePrice: 56000,
      }, pricingContext).customerPrice;
      for (const scope of [
        { slug: "engine", query: articles[0] },
        { slug: "engine-systems", directionSlug: "engine-systems", query: articles[0] },
      ]) {
        const below = await PublicCatalogService.getCategoryProducts({
          ...scope, maxPrice: Number((visiblePrice - 0.01).toFixed(2)), pricingContext,
        }, db);
        assert.equal(below.pagination.total, 0,
          `${pricingContext.priceGroupName}: ${scope.slug} must exclude below visible price`);
        const boundary = await PublicCatalogService.getCategoryProducts({
          ...scope, minPrice: visiblePrice, maxPrice: visiblePrice, pricingContext,
        }, db);
        assert.equal(boundary.pagination.total, 1,
          `${pricingContext.priceGroupName}: ${scope.slug} includes exact visible price`);
      }
    }
    for (const scope of [
      { slug: "engine" },
      { slug: "engine-systems", directionSlug: "engine-systems" },
    ]) {
      const options = { ...scope, query: marker, availability: "available" };
      const under55k = await PublicCatalogService.getCategoryProducts({
        ...options, maxPrice: 55000,
      }, db);
      assert.deepEqual(under55k.products.map((product) => product.article), [articles[1]],
        `${scope.slug}: excludes priority-skipped, reserved, hidden and unavailable low offers`);
      for (const sort of ["price_asc", "price_desc"]) {
        const first = await PublicCatalogService.getCategoryProducts({
          ...options, sort, page: 1,
        }, db);
        const second = await PublicCatalogService.getCategoryProducts({
          ...options, sort, page: 2,
        }, db);
        const listed = [...first.products, ...second.products].map((product) => product.article);
        assert.equal(first.pagination.total, 26);
        assert.equal(second.pagination.total, 26);
        assert.equal(listed.length, 26);
        assert.equal(new Set(listed).size, 26);
        assert.deepEqual(sort === "price_asc" ? listed.slice(0, 5) : listed.slice(-5).reverse(),
          [articles[1], articles[3], articles[4], articles[0], articles[2]],
          `${scope.slug}: ${sort} orders by public prices before pagination`);
      }
    }
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("PostgreSQL merges roots before count, sorting, filtering and pagination without altering existing category listings", async () => {
  const db = await pool.connect();
  const marker = `DIRECTION${Date.now()}${Math.random().toString(16).slice(2, 7)}`.toUpperCase();
  await db.query("BEGIN");
  try {
    const categories = await db.query(`
      SELECT id, slug FROM customer_categories
      WHERE slug IN ('engine', 'cooling') AND status = 'ACTIVE' AND is_active = TRUE
    `);
    const engineId = Number(categories.rows.find((row) => row.slug === "engine")?.id);
    const coolingId = Number(categories.rows.find((row) => row.slug === "cooling")?.id);
    const child = await db.query(`
      SELECT id, slug FROM customer_categories
      WHERE parent_id = $1 AND status = 'ACTIVE' AND is_active = TRUE
      ORDER BY sort_order, id LIMIT 1
    `, [engineId]);
    assert.ok(engineId && coolingId && child.rows[0]);

    const createdProducts = [];
    for (let index = 0; index < 26; index += 1) {
      const article = `${marker}${String(index).padStart(2, "0")}`;
      const product = await db.query(`
        INSERT INTO products(article, article_normalized, name, is_active)
        VALUES($1, $1, $2, TRUE) RETURNING id
      `, [article, `${marker} product ${String(index).padStart(2, "0")}`]);
      createdProducts.push(Number(product.rows[0].id));
      const categoryId = index === 0 ? Number(child.rows[0].id) : index % 2 ? coolingId : engineId;
      await db.query(`
        INSERT INTO product_customer_categories(product_id, customer_category_id, is_primary,
          assignment_source, assignment_origin, confidence, approval_status, approved_at)
        VALUES($1, $2, TRUE, 'MANUAL', 'ADMIN', 'HIGH', 'MANUAL_APPROVED', NOW())
      `, [product.rows[0].id, categoryId]);
    }
    for (const [index, price] of [[0, 30], [1, 10], [2, 20]]) {
      await db.query(`
        INSERT INTO product_offers(product_id, quantity, purchase_price, retail_price,
          source_type, is_available, is_hidden)
        VALUES($1, 5, 5, $2, 'OWN_STOCK', TRUE, FALSE)
      `, [createdProducts[index], price]);
    }

    const options = { slug: "engine-systems", directionSlug: "engine-systems", query: marker, sort: "name_asc" };
    const first = await PublicCatalogService.getCategoryProducts({ ...options, page: 1 }, db);
    const second = await PublicCatalogService.getCategoryProducts({ ...options, page: 2 }, db);
    assert.equal(first.pagination.total, 26);
    assert.equal(first.products.length, 24);
    assert.equal(second.products.length, 2);
    const articles = [...first.products, ...second.products].map((product) => product.article);
    assert.equal(new Set(articles).size, 26);
    assert.deepEqual(articles, [...articles].sort());

    const priceSorted = await PublicCatalogService.getCategoryProducts({
      ...options, page: 1, sort: "price_asc", availability: "available",
    }, db);
    assert.equal(priceSorted.pagination.total, 3);
    assert.deepEqual(priceSorted.products.map((product) => product.article),
      [`${marker}01`, `${marker}02`, `${marker}00`]);

    const childOnly = await PublicCatalogService.getCategoryProducts({
      ...options, subgroupSlug: child.rows[0].slug,
    }, db);
    assert.equal(childOnly.pagination.total, 1);
    assert.equal(childOnly.products[0].article, `${marker}00`);

    const unavailable = await PublicCatalogService.getCategoryProducts({
      ...options, availability: "unavailable",
    }, db);
    const available = await PublicCatalogService.getCategoryProducts({
      ...options, availability: "available",
    }, db);
    assert.equal(unavailable.pagination.total, 23);
    assert.equal(available.pagination.total, 3);

    const oldRoute = await PublicCatalogService.getCategoryProducts({
      slug: "engine", query: marker,
    }, db);
    assert.equal(oldRoute.pagination.total, 13);
    assert.equal(oldRoute.category.isDirection, undefined);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
