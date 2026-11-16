import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";

const url = process.env.MAKA_ROTATION_TEST_DATABASE_URL;
test("rotation migration preserves legacy rows and admin CRUD persists automatic/fixed mode", { skip: !url }, async () => {
  const target = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  assert.match(target.pathname, /^\/maka_rotation_test(?:_[a-z0-9]+)?$/);
  const { HomepageContentService } = await import("./HomepageContentService.js");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const schema = `rotation_test_${randomBytes(6).toString("hex")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE schema_migrations(version TEXT PRIMARY KEY);
      CREATE TABLE homepage_product_features(
        id BIGSERIAL PRIMARY KEY, feature_type TEXT NOT NULL,
        product_id INTEGER NOT NULL, discount_percent NUMERIC,
        starts_on DATE, ends_on DATE, sort_order INTEGER NOT NULL DEFAULT 100,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by INTEGER, updated_by INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO homepage_product_features(feature_type,product_id,sort_order)
      VALUES ('NEW',1,0),('NEW',2,100),('PROMOTION',3,100);
    `);
    const before = (await client.query("SELECT * FROM homepage_product_features ORDER BY id")).rows;
    const migration = await readFile(new URL("../../migrations/132_homepage_feature_daily_rotation.sql", import.meta.url), "utf8");
    await client.query(migration);
    await client.query(migration);
    const after = (await client.query("SELECT * FROM homepage_product_features ORDER BY id")).rows;
    assert.deepEqual(after.map(({ is_position_fixed, ...row }) => row), before);
    assert.ok(after.every(row => row.is_position_fixed === true));
    assert.equal((await client.query("SELECT * FROM schema_migrations")).rowCount, 1);

    // Product metadata joins are irrelevant here; execute the service's actual writes.
    const db = { async query(sql, values) {
      if (sql.includes("FROM products p")) return { rows: [{ id: 10, article: "B66961520", name: "Test product" }] };
      if (sql.includes("FROM homepage_product_features f")) {
        const result = await client.query("SELECT * FROM homepage_product_features" +
          (sql.includes("WHERE f.id=$1") ? " WHERE id=$1" : "") + " ORDER BY sort_order,id", values);
        return { rows: result.rows.map(row => ({ ...row, article: "B66961520", name: "Test product" })) };
      }
      return client.query(sql, values);
    }};
    const created = await HomepageContentService.createFeature({
      featureType: "NEW", article: "B66961520", isPositionFixed: false, sortOrder: 100,
    }, 1, db);
    assert.equal(created.isPositionFixed, false);
    assert.equal((await client.query("SELECT is_position_fixed FROM homepage_product_features WHERE id=$1", [created.id])).rows[0].is_position_fixed, false);
    const updated = await HomepageContentService.updateFeature(created.id, { isActive: false }, 1, db);
    assert.equal(updated.isPositionFixed, false, "unrelated edits must preserve automatic mode");
    const pinned = await HomepageContentService.updateFeature(created.id, { isPositionFixed: true, sortOrder: 2 }, 1, db);
    assert.equal(pinned.isPositionFixed, true);
    assert.equal(pinned.sortOrder, 2);
    const automatic = await HomepageContentService.updateFeature(created.id, { isPositionFixed: false }, 1, db);
    assert.equal(automatic.isPositionFixed, false);
    assert.equal(automatic.sortOrder, 2, "toggling must preserve the previous queue order");
    await assert.rejects(() => HomepageContentService.updateFeature(created.id, { isPositionFixed: "invalid" }, 1, db), /логічне/);
    await assert.rejects(() => HomepageContentService.updateFeature(created.id, { sortOrder: -1 }, 1, db), /Порядок/);
    const legacy = await HomepageContentService.createFeature({ featureType: "NEW", article: "B66961520" }, 1, db);
    assert.equal(legacy.isPositionFixed, true, "older clients keep their existing default");
    const listed = await HomepageContentService.listFeatures(db);
    assert.equal(listed.find(row => row.id === created.id).isPositionFixed, false);
    assert.equal(listed.find(row => row.id === 1).isPositionFixed, true);
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});
