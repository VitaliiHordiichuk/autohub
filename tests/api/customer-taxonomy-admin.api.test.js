import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import { app } from "../../src/app.js";
import { pool } from "../../src/config/db.js";

let server;
let baseUrl;
let productId;
let taxonomyCategoryId;
let technicalCategoryId;
let rule;
const authUsers = new Map();
const createdUserIds = [];

function tokenFor(role) {
  const user = authUsers.get(role);
  return jwt.sign({
    sub: String(user.id),
    role,
    authVersion: Number(user.auth_version || 0),
  }, process.env.AUTH_JWT_SECRET, {
    expiresIn: "10m",
    issuer: "autohub-backend",
    audience: "autohub-client",
  });
}

async function ensureUser(role) {
  const existing = await pool.query(`
    SELECT u.id, u.auth_version
    FROM users u
    JOIN roles role ON role.id = u.role_id
    WHERE role.name = $1
      AND u.is_active = TRUE
      AND u.must_change_password = FALSE
    ORDER BY u.id
    LIMIT 1
  `, [role]);
  if (existing.rowCount) return existing.rows[0];
  const roleResult = await pool.query("SELECT id FROM roles WHERE name = $1", [role]);
  const inserted = await pool.query(`
    INSERT INTO users(first_name, email, password_hash, role_id, is_active)
    VALUES('Taxonomy preview', $1, 'not-used', $2, TRUE)
    RETURNING id, auth_version
  `, [`taxonomy-${role.toLowerCase()}-${Date.now()}@autohub.local`, roleResult.rows[0].id]);
  createdUserIds.push(Number(inserted.rows[0].id));
  return inserted.rows[0];
}

async function request(path, role = "ADMIN", options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Cookie: `autohub_token=${tokenFor(role)}`,
    },
  });
}

before(async () => {
  authUsers.set("ADMIN", await ensureUser("ADMIN"));
  authUsers.set("MANAGER", await ensureUser("MANAGER"));

  const categoryResult = await pool.query(`
    SELECT id FROM customer_categories WHERE slug = 'filters-oil'
  `);
  taxonomyCategoryId = Number(categoryResult.rows[0].id);
  const ruleResult = await pool.query(`
    SELECT code, version FROM customer_classification_rules
    WHERE code = 'FILTER_OIL_A_EPC18_V1' AND is_active = TRUE
  `);
  rule = ruleResult.rows[0];
  const technicalResult = await pool.query(`
    SELECT id FROM categories WHERE is_active = TRUE ORDER BY id LIMIT 1
  `);
  technicalCategoryId = Number(technicalResult.rows[0].id);
  const article = `A00018${String(Date.now()).slice(-6)}`;
  const productResult = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Customer taxonomy admin fixture', TRUE)
    RETURNING id
  `, [article]);
  productId = Number(productResult.rows[0].id);
  await pool.query(`
    INSERT INTO product_categories(product_id, category_id, assignment_source, confidence)
    VALUES($1, $2, 'MANUAL', 100)
  `, [productId, technicalCategoryId]);
  await pool.query(`
    INSERT INTO product_customer_categories(
      product_id, customer_category_id, is_primary,
      assignment_source, assignment_origin, rule_code, rule_version,
      confidence, approval_status, approved_at
    ) VALUES($1, $2, TRUE, 'RULE', 'BACKFILL', $3, $4,
             'HIGH', 'AUTO_APPROVED', NOW())
  `, [productId, taxonomyCategoryId, rule.code, rule.version]);

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    )));
  }
  if (productId) {
    await pool.query("DELETE FROM product_customer_categories WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM product_categories WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
  }
  if (createdUserIds.length) {
    await pool.query("DELETE FROM users WHERE id = ANY($1::integer[])", [createdUserIds]);
  }
  await pool.end();
});

test("customer taxonomy preview requires an authenticated admin or manager", async () => {
  const guest = await fetch(`${baseUrl}/api/admin/customer-taxonomy`);
  assert.equal(guest.status, 401);
  assert.equal((await request("/api/admin/customer-taxonomy", "ADMIN")).status, 200);
  assert.equal((await request("/api/admin/customer-taxonomy", "MANAGER")).status, 200);
});

test("tree and integrity counts come from aggregate database state", async () => {
  const response = await request("/api/admin/customer-taxonomy?locale=uk");
  assert.equal(response.status, 200);
  const body = await response.json();
  const leaf = body.categories.find((category) => category.slug === "filters-oil");
  const root = body.categories.find((category) => category.slug === "filters-maintenance");
  assert.ok(leaf.membershipCount >= 1);
  assert.ok(root.membershipCount >= leaf.membershipCount);
  const expected = await pool.query("SELECT COUNT(*)::integer AS count FROM product_customer_categories");
  assert.equal(body.integrity.memberships, expected.rows[0].count);
  assert.equal(body.integrity.duplicatePrimary, 0);
  assert.equal(body.integrity.orphanRules, 0);
  assert.equal(body.integrity.inactiveTargets, 0);
});

test("category products are paginated, searchable and include EPC plus rule provenance", async () => {
  const product = await pool.query("SELECT article FROM products WHERE id = $1", [productId]);
  const query = new URLSearchParams({
    locale: "en",
    search: product.rows[0].article,
    page: "1",
    pageSize: "25",
    assignmentSource: "RULE",
    assignmentOrigin: "BACKFILL",
    confidence: "HIGH",
    approvalStatus: "AUTO_APPROVED",
    ruleCode: rule.code,
    numberFamily: "A",
    epcGroup: "18",
  });
  const response = await request(
    `/api/admin/customer-taxonomy/categories/filters-oil/products?${query}`,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.pageSize, 25);
  const row = body.products.find((item) => item.productId === productId);
  assert.ok(row);
  assert.equal(row.technicalEpcGroup, "18");
  assert.ok(row.technicalCategories.some((category) => category.id === technicalCategoryId));
  assert.equal(row.customerCategory.slug, "filters-oil");
  assert.equal(row.assignmentSource, "RULE");
  assert.equal(row.assignmentOrigin, "BACKFILL");
  assert.equal(row.ruleCode, rule.code);
  assert.equal(row.confidence, "HIGH");
  assert.equal(row.approvalStatus, "AUTO_APPROVED");
  assert.equal(row.isPrimary, true);
});

test("product details compare technical and customer classifications", async () => {
  const response = await request(
    `/api/admin/customer-taxonomy/products/${productId}?locale=ru`,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.product.id, productId);
  assert.equal(body.product.technicalEpcGroup, "18");
  assert.ok(body.product.technicalCategories.length >= 1);
  assert.equal(body.product.customerClassifications[0].customerCategory.slug, "filters-oil");
  assert.equal(body.product.customerClassifications[0].ruleCode, rule.code);
});

test("customer taxonomy admin API exposes no mutation endpoint", async () => {
  const response = await request("/api/admin/customer-taxonomy", "ADMIN", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "brakes" }),
  });
  assert.equal(response.status, 404);
});
