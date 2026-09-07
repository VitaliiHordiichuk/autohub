import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { AdminCatalogCategoryService } from "../src/services/AdminCatalogCategoryService.js";
import { EffectiveProductCategoryService } from "../src/services/EffectiveProductCategoryService.js";
import { PublicCatalogService } from "../src/services/PublicCatalogService.js";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let rootCategoryId;
let rootCategorySlug;
let childCategoryId;
let childCategorySlug;
let fixtureProductId;
let mercedesBrandId;
let accessoryProductId;
let inactiveAccessoryProductId;
let fallbackProductId;
let nonMercedesProductId;
const mercedesGroupProductIds = [];
const mercedesAccessoryProductIds = [];
const sortingProductIds = [];

before(async () => {
  const product = await pool.query(`
    SELECT id FROM products
    WHERE article_normalized = 'A2711800109'
    LIMIT 1
  `);
  assert.ok(product.rows[0], "Тестовый товар каталога не найден");
  fixtureProductId = Number(product.rows[0].id);

  const brand = await pool.query(`
    SELECT id FROM brands
    WHERE LOWER(name) LIKE '%mercedes%'
    ORDER BY id LIMIT 1
  `);
  assert.ok(brand.rows[0], "Бренд Mercedes-Benz не найден");
  mercedesBrandId = Number(brand.rows[0].id);
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
  if (nonMercedesProductId) {
    await pool.query("DELETE FROM product_categories WHERE product_id = $1", [nonMercedesProductId]);
    await pool.query("DELETE FROM products WHERE id = $1", [nonMercedesProductId]);
  }
  if (mercedesGroupProductIds.length) {
    await pool.query("DELETE FROM product_categories WHERE product_id = ANY($1::integer[])", [mercedesGroupProductIds]);
    await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [mercedesGroupProductIds]);
  }
  if (mercedesAccessoryProductIds.length) {
    await pool.query("DELETE FROM product_categories WHERE product_id = ANY($1::integer[])", [mercedesAccessoryProductIds]);
    await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [mercedesAccessoryProductIds]);
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
  rootCategorySlug = root.slug;

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

test("аксессуары отображаются первой основной группой каталога", async () => {
  const tree = await PublicCatalogService.getTree("ru");

  assert.equal(tree[0]?.slug, "accessories");
});

test("резервная группа Остальное всегда доступна в публичном каталоге", async () => {
  const tree = await PublicCatalogService.getTree("ru");
  const other = tree.find((category) => category.slug === "other");

  assert.ok(other);
  assert.equal(other.name, "Остальное");
  assert.equal(other.parentId, null);
});

test("миграция сбрасывает прежние ручные назначения Mercedes", async () => {
  const assigned = await pool.query(`
    SELECT category.slug, pc.assignment_source
    FROM products product
    JOIN product_categories pc ON pc.product_id = product.id
    JOIN categories category ON category.id = pc.category_id
    WHERE product.article_normalized = 'A000010030164'
    ORDER BY pc.assignment_source, category.id
  `);

  assert.equal(assigned.rowCount, 1);
  assert.equal(assigned.rows[0].slug, "mb-group-01");
  assert.equal(assigned.rows[0].assignment_source, "AUTO_RULE");
});

test("нераспознанный Mercedes-артикул автоматически попадает в группу Остальное", async () => {
  const article = `N${String(Date.now()).slice(-12)}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Уникальная тестовая позиция Mercedes', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
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

test("нераспознанный товар другого бренда не попадает в Mercedes-группу Остальное", async () => {
  const article = `OTHER${Date.now()}`;
  const inserted = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Уникальная позиция другого бренда', TRUE)
    RETURNING id
  `, [article]);
  nonMercedesProductId = Number(inserted.rows[0].id);

  const assigned = await pool.query(`
    SELECT c.slug
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
  `, [nonMercedesProductId]);

  assert.equal(assigned.rowCount, 0);
});

test("Mercedes A распределяется по двум цифрам основной группы артикула", async () => {
  const article = `A2113200304${String(Date.now()).slice(-4)}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Тестовая деталь подвески Mercedes', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
  const productId = Number(inserted.rows[0].id);
  mercedesGroupProductIds.push(productId);

  const assigned = await pool.query(`
    SELECT category.slug, parent.slug AS parent_slug,
           pc.assignment_source, pc.confidence
    FROM product_categories pc
    JOIN categories category ON category.id = pc.category_id
    LEFT JOIN categories parent ON parent.id = category.parent_id
    WHERE pc.product_id = $1
  `, [productId]);

  assert.equal(assigned.rowCount, 1);
  assert.equal(assigned.rows[0].slug, "mb-group-32");
  assert.equal(assigned.rows[0].parent_slug, "suspension");
  assert.equal(assigned.rows[0].assignment_source, "AUTO_RULE");
  assert.equal(Number(assigned.rows[0].confidence), 100);
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
  assert.ok(stored.rows.some((row) => row.slug === "mb-group-18"));
});

test("Mercedes B6 попадает в подтверждённое семейство аксессуаров", async () => {
  const article = `B6695${String(Date.now()).slice(-6)}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Тестовый аксессуар', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
  accessoryProductId = Number(inserted.rows[0].id);

  const assigned = await pool.query(`
    SELECT c.slug, pc.assignment_source
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
  `, [accessoryProductId]);
  assert.equal(assigned.rowCount, 1);
  assert.equal(assigned.rows[0].slug, "mb-accessories-collection");
  assert.equal(assigned.rows[0].assignment_source, "ACCESSORY_RULE");

  const adminResult = await AdminCatalogCategoryService.searchProducts({ search: article });
  assert.equal(adminResult.products.length, 1);
  assert.equal(adminResult.products[0].assignments.length, 1);
  assert.equal(adminResult.products[0].assignments[0].rule.prefix, "B6695");
  assert.equal(adminResult.products[0].assignments[0].confidence, 100);
});

test("повторный импорт автоматически заменяет аксессуарную группу B6", async () => {
  assert.ok(accessoryProductId);
  const article = `B6603${String(Date.now()).slice(-6)}`;

  await pool.query(`
    UPDATE products
    SET article = $2,
        article_normalized = $2,
        name = 'Велюровый коврик после обновления прайса'
    WHERE id = $1
  `, [accessoryProductId, article]);

  const assigned = await pool.query(`
    SELECT category.slug, assignment.assignment_source
    FROM product_categories assignment
    JOIN categories category ON category.id = assignment.category_id
    WHERE assignment.product_id = $1
  `, [accessoryProductId]);

  assert.deepEqual(assigned.rows, [{
    slug: "mb-accessories-floor-mats",
    assignment_source: "ACCESSORY_RULE",
  }]);
});

test("одинаковый аксессуарный префикс нельзя назначить двум категориям", async () => {
  const category = await pool.query(`
    SELECT id FROM categories WHERE slug = 'mb-accessories-floor-mats'
  `);

  await assert.rejects(
    pool.query(`
      INSERT INTO mercedes_accessory_rules(
        article_prefix, article_type, match_type, material_subgroup,
        category_id, priority, confidence, active, notes
      )
      VALUES('B6695', 'B6', 'PREFIX', 'CONFLICT_TEST', $1, 1, 100, TRUE, 'Must fail')
    `, [category.rows[0].id]),
    (error) => error?.code === "23505",
  );
});

test("A-артикулы нельзя массово объявить аксессуарами по префиксу", async () => {
  const category = await pool.query(`
    SELECT id FROM categories WHERE slug = 'mb-accessories-floor-mats'
  `);

  await assert.rejects(
    pool.query(`
      INSERT INTO mercedes_accessory_rules(
        article_prefix, article_type, match_type, material_subgroup,
        category_id, priority, confidence, active, notes
      )
      VALUES('A20468', 'A', 'PREFIX', 'UNSAFE_TEST', $1, 1, 100, TRUE, 'Must fail')
    `, [category.rows[0].id]),
    (error) => error?.code === "23514",
  );
});

test("неизвестное семейство B6 попадает только в аксессуарное Другое", async () => {
  const article = `B6998${String(Date.now()).slice(-6)}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Неизвестный тестовый B6', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
  const productId = Number(inserted.rows[0].id);
  mercedesAccessoryProductIds.push(productId);

  const assigned = await pool.query(`
    SELECT c.slug, pc.assignment_source, pc.confidence
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
  `, [productId]);

  assert.equal(assigned.rowCount, 1);
  assert.equal(assigned.rows[0].slug, "mb-accessories-other");
  assert.equal(assigned.rows[0].assignment_source, "ACCESSORY_RULE");
  assert.equal(Number(assigned.rows[0].confidence), 0);

  const warnings = await AdminCatalogCategoryService.getClassificationWarnings();
  assert.ok(warnings.unclassifiedMercedesAccessories.count >= 1);
  assert.ok(warnings.unclassifiedMercedesAccessories.examples.some(
    (product) => product.article === article,
  ));
});

test("Mercedes B, но не B6, не считается аксессуаром", async () => {
  const article = `B2${String(Date.now()).slice(-8)}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Не B6 Mercedes', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
  const productId = Number(inserted.rows[0].id);
  mercedesAccessoryProductIds.push(productId);

  const assigned = await pool.query(`
    SELECT c.slug, pc.assignment_source
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
  `, [productId]);

  assert.deepEqual(assigned.rows, [{ slug: "other", assignment_source: "AUTO_RULE" }]);
});

test("пробелы и регистр не мешают распознать B6", async () => {
  const article = `b 6 603 ${String(Date.now()).slice(-4)}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Велюровый коврик', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
  const productId = Number(inserted.rows[0].id);
  mercedesAccessoryProductIds.push(productId);

  const assigned = await pool.query(`
    SELECT c.slug
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
  `, [productId]);
  assert.equal(assigned.rows[0].slug, "mb-accessories-floor-mats");
});

test("Mercedes A может иметь функциональную и аксессуарную категории", async () => {
  const article = "A2046804348";
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Килимки Mercedes', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
  const productId = Number(inserted.rows[0].id);
  mercedesAccessoryProductIds.push(productId);

  const assigned = await pool.query(`
    SELECT c.slug, pc.assignment_source
    FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = $1
    ORDER BY pc.assignment_source
  `, [productId]);

  assert.deepEqual(new Set(assigned.rows.map((row) => row.slug)), new Set([
    "mb-group-68",
    "mb-accessories-floor-mats",
  ]));
  assert.deepEqual(new Set(assigned.rows.map((row) => row.assignment_source)), new Set([
    "AUTO_RULE",
    "ACCESSORY_RULE",
  ]));

  const adminResult = await AdminCatalogCategoryService.searchProducts({ search: article });
  assert.deepEqual(
    adminResult.products[0].assignments.map((assignment) => assignment.assignmentSource),
    ["AUTO_RULE", "ACCESSORY_RULE"],
  );
  assert.equal(adminResult.products[0].category.slug, "mb-group-68");

  const functionalManualCategory = await pool.query(
    "SELECT id FROM categories WHERE slug = 'other'",
  );
  const accessoryManualCategory = await pool.query(
    "SELECT id FROM categories WHERE slug = 'mb-accessories-luggage'",
  );
  const functionalManualId = Number(functionalManualCategory.rows[0].id);
  const accessoryManualId = Number(accessoryManualCategory.rows[0].id);

  const readAssignments = async () => {
    const result = await pool.query(`
      SELECT category.slug, assignment.assignment_source
      FROM product_categories assignment
      JOIN categories category ON category.id = assignment.category_id
      WHERE assignment.product_id = $1
    `, [productId]);
    return new Set(result.rows.map(
      (row) => `${row.slug}:${row.assignment_source}`,
    ));
  };

  await AdminCatalogCategoryService.setProductCategory(productId, functionalManualId);
  assert.deepEqual(await readAssignments(), new Set([
    "other:MANUAL",
    "mb-accessories-floor-mats:ACCESSORY_RULE",
  ]));

  await AdminCatalogCategoryService.setProductCategory(productId, null);
  assert.deepEqual(await readAssignments(), new Set([
    "mb-group-68:AUTO_RULE",
    "mb-accessories-floor-mats:ACCESSORY_RULE",
  ]));

  await AdminCatalogCategoryService.setProductCategory(productId, accessoryManualId);
  assert.deepEqual(await readAssignments(), new Set([
    "mb-group-68:AUTO_RULE",
    "mb-accessories-luggage:MANUAL",
  ]));

  await AdminCatalogCategoryService.setProductCategory(productId, functionalManualId);
  assert.deepEqual(await readAssignments(), new Set([
    "other:MANUAL",
    "mb-accessories-luggage:MANUAL",
  ]));

  const finalAdminResult = await AdminCatalogCategoryService.searchProducts({ search: article });
  assert.equal(finalAdminResult.products[0].category.slug, "other");
  assert.deepEqual(
    finalAdminResult.products[0].assignments.map((assignment) => assignment.slug),
    ["other", "mb-accessories-luggage"],
  );
});

test("проверенные A-брызговики определяются только по точному артикулу", async () => {
  const verifiedArticles = [
    "A1648990640",
    "A1768900178",
    "A4478900000",
    "A4478900100",
  ];

  const rules = await pool.query(`
    SELECT article_prefix, match_type, confidence, category.slug
    FROM mercedes_accessory_rules rule
    JOIN categories category ON category.id = rule.category_id
    WHERE rule.article_type = 'A'
      AND rule.article_prefix = ANY($1::text[])
    ORDER BY rule.article_prefix
  `, [verifiedArticles]);

  assert.deepEqual(rules.rows, verifiedArticles.sort().map((article) => ({
    article_prefix: article,
    match_type: "EXACT",
    confidence: "100.00",
    slug: "mb-accessories-exterior",
  })));

  const products = await pool.query(`
    SELECT id
    FROM products
    WHERE REGEXP_REPLACE(
      UPPER(COALESCE(article_normalized, article, '')),
      '[^A-Z0-9]', '', 'g'
    ) = ANY($1::text[])
  `, [verifiedArticles]);
  assert.equal(products.rowCount, verifiedArticles.length);

  for (const product of products.rows) {
    await pool.query("SELECT classify_mercedes_accessory_category($1)", [product.id]);
  }

  const assigned = await pool.query(`
    SELECT REGEXP_REPLACE(
             UPPER(COALESCE(product.article_normalized, product.article, '')),
             '[^A-Z0-9]', '', 'g'
           ) AS article,
           category.slug,
           assignment.assignment_source,
           assignment.confidence
    FROM products product
    JOIN product_categories assignment ON assignment.product_id = product.id
    JOIN categories category ON category.id = assignment.category_id
    WHERE REGEXP_REPLACE(
      UPPER(COALESCE(product.article_normalized, product.article, '')),
      '[^A-Z0-9]', '', 'g'
    ) = ANY($1::text[])
      AND assignment.assignment_source = 'ACCESSORY_RULE'
    ORDER BY article
  `, [verifiedArticles]);

  assert.deepEqual(assigned.rows, verifiedArticles.sort().map((article) => ({
    article,
    slug: "mb-accessories-exterior",
    assignment_source: "ACCESSORY_RULE",
    confidence: "100.00",
  })));
});

test("неоднозначные A-брызговики остаются только в функциональной категории", async () => {
  const bodyPartArticles = ["A2046905630", "A2216901930"];
  const products = await pool.query(`
    SELECT id
    FROM products
    WHERE REGEXP_REPLACE(
      UPPER(COALESCE(article_normalized, article, '')),
      '[^A-Z0-9]', '', 'g'
    ) = ANY($1::text[])
  `, [bodyPartArticles]);
  assert.equal(products.rowCount, bodyPartArticles.length);

  for (const product of products.rows) {
    await pool.query("SELECT classify_product_category($1)", [product.id]);
  }

  const assigned = await pool.query(`
    SELECT REGEXP_REPLACE(
             UPPER(COALESCE(product.article_normalized, product.article, '')),
             '[^A-Z0-9]', '', 'g'
           ) AS article,
           category.slug,
           assignment.assignment_source
    FROM products product
    JOIN product_categories assignment ON assignment.product_id = product.id
    JOIN categories category ON category.id = assignment.category_id
    WHERE REGEXP_REPLACE(
      UPPER(COALESCE(product.article_normalized, product.article, '')),
      '[^A-Z0-9]', '', 'g'
    ) = ANY($1::text[])
    ORDER BY article, assignment.assignment_source, category.slug
  `, [bodyPartArticles]);

  assert.deepEqual(assigned.rows, bodyPartArticles.sort().map((article) => ({
    article,
    slug: "mb-group-69",
    assignment_source: "AUTO_RULE",
  })));
});

test("неизвестный Mercedes A остаётся только в функциональной группе", async () => {
  const article = `A204680${String(Date.now()).slice(-4)}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Опора тестовая Mercedes', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
  const productId = Number(inserted.rows[0].id);
  mercedesAccessoryProductIds.push(productId);

  const assigned = await pool.query(`
    SELECT category.slug, assignment.assignment_source
    FROM product_categories assignment
    JOIN categories category ON category.id = assignment.category_id
    WHERE assignment.product_id = $1
  `, [productId]);

  assert.deepEqual(assigned.rows, [{
    slug: "mb-group-68",
    assignment_source: "AUTO_RULE",
  }]);
});

test("Mercedes A с однозначным названием получает отдельную аксессуарную группу", async () => {
  const article = `A204680${String(Date.now() + 1).slice(-4)}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Килимки салону гумові', TRUE)
    RETURNING id
  `, [mercedesBrandId, article]);
  const productId = Number(inserted.rows[0].id);
  mercedesAccessoryProductIds.push(productId);

  const assigned = await pool.query(`
    SELECT category.slug, assignment.assignment_source, assignment.confidence
    FROM product_categories assignment
    JOIN categories category ON category.id = assignment.category_id
    WHERE assignment.product_id = $1
  `, [productId]);

  assert.deepEqual(new Set(assigned.rows.map(
    (row) => `${row.slug}:${row.assignment_source}:${Number(row.confidence)}`,
  )), new Set([
    "mb-group-68:AUTO_RULE:100",
    "mb-accessories-floor-mats:ACCESSORY_RULE:95",
  ]));

  const adminResult = await AdminCatalogCategoryService.searchProducts({ search: article });
  const accessory = adminResult.products[0].assignments.find(
    (assignment) => assignment.assignmentSource === "ACCESSORY_RULE",
  );
  assert.equal(accessory?.rule?.matchType, "NAME_REGEX");
});

test("неактивный товар не увеличивает публичный счётчик группы", async () => {
  const beforeTree = await PublicCatalogService.getTree("ru");
  const before = beforeTree.find((category) => category.slug === "accessories");
  assert.ok(before);

  const article = `BINACTIVE${Date.now()}`;
  const inserted = await pool.query(`
    INSERT INTO products(brand_id, article, article_normalized, name, is_active)
    VALUES($1, $2, $2, 'Неактивный тестовый аксессуар', FALSE)
    RETURNING id
  `, [mercedesBrandId, article]);
  inactiveAccessoryProductId = Number(inserted.rows[0].id);

  const afterTree = await PublicCatalogService.getTree("ru");
  const after = afterTree.find((category) => category.slug === "accessories");
  assert.equal(after?.directProductCount, before.directProductCount);
  assert.equal(after?.productCount, before.productCount);
});

test("каталог сначала показывает наличие, а фото учитывает внутри группы наличия", async () => {
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
    VALUES($1, $2, 0), ($1, $3, 1)
  `, [
    ids.unavailableWithPhoto,
    `https://example.com/${articleSuffix}-primary.webp`,
    `https://example.com/${articleSuffix}-secondary.webp`,
  ]);

  // Имитируем старые данные с двумя назначениями. Все публичные части сайта
  // должны одинаково выбрать более точную подгруппу и не задвоить товар.
  await pool.query(`
    INSERT INTO product_categories(product_id, category_id, assignment_source, confidence)
    VALUES($1, $2, 'MANUAL', 100)
  `, [ids.unavailableWithPhoto, rootCategoryId]);

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
  assert.deepEqual(result.products[1].image_urls, [
    `https://example.com/${articleSuffix}-primary.webp`,
    `https://example.com/${articleSuffix}-secondary.webp`,
  ]);
  assert.equal(result.products[2].hasRealImage, false);

  const effectiveCategory = await EffectiveProductCategoryService.getByProductId(
    ids.unavailableWithPhoto,
  );
  assert.equal(Number(effectiveCategory.id), childCategoryId);

  const parentResult = await PublicCatalogService.getCategoryProducts({
    slug: rootCategorySlug,
    locale: "ru",
  });
  assert.equal(parentResult.pagination.total, 3);
  assert.deepEqual(
    new Set(parentResult.products.map((product) => Number(product.id))),
    new Set(Object.values(ids)),
  );
  assert.deepEqual(parentResult.category.children, [{
    id: childCategoryId,
    slug: childCategorySlug,
    name: `Тестовая подгруппа ${suffix}`,
    productCount: 3,
  }]);
});
