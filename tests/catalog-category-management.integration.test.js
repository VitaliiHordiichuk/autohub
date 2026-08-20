import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { AdminCatalogCategoryService } from "../src/services/AdminCatalogCategoryService.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let rootCategoryId;
let childCategoryId;
let childCategorySlug;
let fixtureProductId;
let accessoryProductId;
let inactiveAccessoryProductId;
let fallbackProductId;
const sortingProductIds = [];

before(async () => {
  const product = await pool.query(`
    SELECT id FROM products
    WHERE article_normalized = 'A2711800109'
    LIMIT 1
  `);
  assert.ok(product.rows[0], "Тестовый товар каталога не найден");
  fixtureProductId = Number(product.rows[0].id);
});

after(async () => {
  if (sortingProductIds.length) {
    await pool.query("DELETE FROM product_offers WHERE product_id = ANY($1::integer[])", [sortingProductIds]);
    await pool.query("DELETE FROM product_images WHERE product_id = ANY($1::integer[])", [sortingProductIds]);
    await pool.query("DELETE FROM product_categories WHERE product_id = ANY($1::integer[])", [sortingProductIds]);
    await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [sortingProductIds]);
  }
  if (fallbackProductId) {
    await pool.query("DELETE FROM product_categories WHERE product_id = $1", [fallbackProductId]);
    await pool.query("DELETE FROM products WHERE id = $1", [fallbackProductId]);
  }
  if (accessoryProductId) {
    await pool.query("DELETE FROM product_categories WHERE product_id = $1", [accessoryProductId]);
    await pool.query("DELETE FROM products WHERE id = $1", [accessoryProductId]);
  }
  if (inactiveAccessoryProductId) {
    await pool.query("DELETE FROM product_categories WHERE product_id = $1", [inactiveAccessoryProductId]);
    await pool.query("DELETE FROM products WHERE id = $1", [inactiveAccessoryProductId]);
  }
  if (fixtureProductId) {
    await pool.query("DELETE FROM product_categories WHERE product_id = $1", [fixtureProductId]);
    await pool.query("SELECT classify_product_category($1)", [fixtureProductId]);
    await pool.query("SELECT apply_catalog_assignment_overrides($1)", [fixtureProductId]);
  }
  if (childCategoryId) await pool.query("DELETE FROM categories WHERE id = $1", [childCategoryId]);
  if (rootCategoryId) await pool.query("DELETE FROM categories WHERE id = $1", [rootCategoryId]);
  await pool.end();
});

test("администратор создаёт основную группу и подгруппу", async () => {
  const root = await AdminCatalogCategoryService.createCategory({
    nameUk: `Тестова група ${suffix}`,
    nameRu: `Тестовая группа ${suffix}`,
    nameEn: `Test group ${suffix}`,
  });
  rootCategoryId = root.id;

  const child = await AdminCatalogCategoryService.createCategory({
    parentId: rootCategoryId,
    nameUk: `Тестова підгрупа ${suffix}`,
    nameRu: `Тестовая подгруппа ${suffix}`,
    nameEn: `Test subgroup ${suffix}`,
  });
  childCategoryId = child.id;
  childCategorySlug = child.slug;

  const categories = await AdminCatalogCategoryService.listCategories();
  const storedRoot = categories.find((category) => category.id === rootCategoryId);
  const storedChild = categories.find((category) => category.id === childCategoryId);
  assert.ok(storedRoot);
  assert.equal(storedRoot.parent, null);
  assert.equal(storedRoot.hasChildren, true);
  assert.equal(storedChild?.parent?.id, rootCategoryId);
});

test("товар без подходящего правила автоматически попадает в группу Остальное", async () => {
  const article = `OTHER${Date.now()}`;
  const inserted = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Уникальная тестовая позиция', TRUE)
    RETURNING id
  `, [article]);
  fallbackProductId = Number(inserted.rows[0].id);

  const assigned = await pool.query(`
    SELECT c.slug, pc.assignment_source, pc.confidence
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
  `, [fallbackProductId]);

  assert.equal(assigned.rowCount, 1);
  assert.equal(assigned.rows[0].slug, "other");
  assert.equal(assigned.rows[0].assignment_source, "AUTO_RULE");
  assert.equal(Number(assigned.rows[0].confidence), 0);
});

test("товар получает выбранную вручную подгруппу", async () => {
  const assignment = await AdminCatalogCategoryService.setProductCategory(fixtureProductId, childCategoryId);
  assert.equal(assignment.assignmentSource, "MANUAL");

  const stored = await pool.query(`
    SELECT category_id, assignment_source
    FROM product_categories
    WHERE product_id = $1
  `, [fixtureProductId]);
  assert.equal(stored.rowCount, 1);
  assert.equal(Number(stored.rows[0].category_id), childCategoryId);
  assert.equal(stored.rows[0].assignment_source, "MANUAL");
});

test("возврат в автоматический режим удаляет ручное назначение", async () => {
  const assignment = await AdminCatalogCategoryService.setProductCategory(fixtureProductId, null);
  assert.equal(assignment.assignmentSource, "AUTO_RULE");

  const stored = await pool.query(`
    SELECT pc.assignment_source, c.slug
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
  `, [fixtureProductId]);
  assert.ok(stored.rowCount > 0);
  assert.ok(stored.rows.every((row) => row.assignment_source === "AUTO_RULE"));
  assert.ok(stored.rows.some((row) => row.slug === "filter-oil"));
});

test("Mercedes-артикул B автоматически попадает в аксессуары", async () => {
  const brand = await pool.query(`
    SELECT id FROM brands
    WHERE LOWER(name) LIKE '%mercedes%'
    ORDER BY id LIMIT 1
  `);
  assert.ok(brand.rows[0], "Бренд Mercedes-Benz не найден");

  const article = `BTEST${Date.now()}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Тестовый аксессуар', TRUE)
    RETURNING id
  `, [brand.rows[0].id, article]);
  accessoryProductId = Number(inserted.rows[0].id);

  const assigned = await pool.query(`
    SELECT c.slug, pc.assignment_source
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
  `, [accessoryProductId]);
  assert.equal(assigned.rowCount, 1);
  assert.equal(assigned.rows[0].slug, "accessories");
  assert.equal(assigned.rows[0].assignment_source, "AUTO_RULE");
});

test("неактивный товар не увеличивает публичный счётчик группы", async () => {
  const beforeTree = await PublicCatalogService.getTree("ru");
  const before = beforeTree.find((category) => category.slug === "accessories");
  assert.ok(before);

  const brand = await pool.query(`
    SELECT id FROM brands
    WHERE LOWER(name) LIKE '%mercedes%'
    ORDER BY id LIMIT 1
  `);
  const article = `BINACTIVE${Date.now()}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Неактивный тестовый аксессуар', FALSE)
    RETURNING id
  `, [brand.rows[0].id, article]);
  inactiveAccessoryProductId = Number(inserted.rows[0].id);

  const afterTree = await PublicCatalogService.getTree("ru");
  const after = afterTree.find((category) => category.slug === "accessories");
  assert.equal(after?.directProductCount, before.directProductCount);
  assert.equal(after?.productCount, before.productCount);
});

test("каталог показывает сначала наличие, затем фото без наличия, затем остальные позиции", async () => {
  const articleSuffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const fixtures = [
    { key: "availableWithoutPhoto", article: `SORTA${articleSuffix}`, name: "Я Товар в наличии" },
    { key: "unavailableWithPhoto", article: `SORTB${articleSuffix}`, name: "А Товар без наличия с фото" },
    { key: "unavailableWithoutPhoto", article: `SORTC${articleSuffix}`, name: "Б Товар без наличия и фото" },
  ];

  const ids = {};
  for (const fixture of fixtures) {
    const inserted = await pool.query(`
      INSERT INTO products(article, article_normalized, name, is_active)
      VALUES($1, $1, $2, TRUE)
      RETURNING id
    `, [fixture.article, fixture.name]);
    const productId = Number(inserted.rows[0].id);
    ids[fixture.key] = productId;
    sortingProductIds.push(productId);

    await pool.query("DELETE FROM product_categories WHERE product_id = $1", [productId]);
    await pool.query(`
      INSERT INTO product_categories(product_id, category_id, assignment_source, confidence)
      VALUES($1, $2, 'MANUAL', 100)
    `, [productId, childCategoryId]);
  }

  await pool.query(`
    INSERT INTO product_offers(
      product_id, quantity, purchase_price, retail_price,
      source_type, is_available, is_hidden
    )
    VALUES($1, 5, 10, 20, 'OWN_STOCK', TRUE, FALSE)
  `, [ids.availableWithoutPhoto]);

  await pool.query(`
    INSERT INTO product_images(product_id, url, priority)
    VALUES($1, $2, 0)
  `, [ids.unavailableWithPhoto, `https://example.com/${articleSuffix}.webp`]);

  const result = await PublicCatalogService.getCategoryProducts({
    slug: childCategorySlug,
    locale: "ru",
  });

  assert.deepEqual(
    result.products.map((product) => Number(product.id)),
    [
      ids.availableWithoutPhoto,
      ids.unavailableWithPhoto,
      ids.unavailableWithoutPhoto,
    ],
  );
  assert.equal(result.products[0].offers.length, 1);
  assert.equal(result.products[1].hasRealImage, true);
  assert.equal(result.products[2].hasRealImage, false);
});
