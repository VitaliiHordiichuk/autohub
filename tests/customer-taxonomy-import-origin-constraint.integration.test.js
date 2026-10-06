import assert from "node:assert/strict";
import test, { after } from "node:test";

import { pool } from "../src/config/db.js";

after(async () => {
  await pool.end();
});

async function insertMembership(db, {
  productId,
  categoryId,
  assignmentSource,
  assignmentOrigin,
  ruleCode = null,
  ruleVersion = null,
  confidence,
  approvalStatus = "AUTO_APPROVED",
}) {
  return db.query(`
    INSERT INTO product_customer_categories(
      product_id,
      customer_category_id,
      is_primary,
      assignment_source,
      assignment_origin,
      rule_code,
      rule_version,
      confidence,
      approval_status,
      assigned_at,
      approved_at,
      updated_at
    ) VALUES(
      $1, $2, FALSE, $3, $4, $5, $6, $7, $8,
      clock_timestamp(),
      clock_timestamp(),
      clock_timestamp()
    )
  `, [
    productId,
    categoryId,
    assignmentSource,
    assignmentOrigin,
    ruleCode,
    ruleVersion,
    confidence,
    approvalStatus,
  ]);
}

async function assertRejected(db, input) {
  await db.query("SAVEPOINT invalid_customer_taxonomy_membership");
  try {
    await assert.rejects(
      insertMembership(db, input),
      (error) => (
        error?.code === "23514"
        && error?.constraint === "product_customer_categories_auto_approval_check"
      ),
    );
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT invalid_customer_taxonomy_membership");
    await db.query("RELEASE SAVEPOINT invalid_customer_taxonomy_membership");
  }
}

test("SAFE import origin extends only the existing EPC_FALLBACK/MEDIUM constraint branch", async () => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const definitionResult = await db.query(`
      SELECT pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint constraint_row
      JOIN pg_class table_row
        ON table_row.oid = constraint_row.conrelid
      WHERE table_row.relname = 'product_customer_categories'
        AND constraint_row.conname = 'product_customer_categories_auto_approval_check'
    `);
    assert.equal(definitionResult.rowCount, 1);
    const definition = definitionResult.rows[0].definition;
    assert.match(definition, /assignment_origin.*BACKFILL.*IMPORT/is);
    assert.doesNotMatch(definition, /assignment_origin.*ADMIN/is);
    assert.doesNotMatch(definition, /assignment_origin.*SYSTEM/is);

    const fixture = await db.query(`
      INSERT INTO products(article, article_normalized, name, is_active)
      VALUES($1, $1, $2, TRUE)
      RETURNING id
    `, [`TAXORIGIN${process.pid}${Date.now()}`, "Customer taxonomy origin constraint fixture"]);
    const productId = Number(fixture.rows[0].id);

    const categories = await db.query(`
      SELECT id, slug
      FROM customer_categories
      WHERE parent_id IS NULL
        AND status = 'ACTIVE'
        AND is_active = TRUE
      ORDER BY id
      LIMIT 6
    `);
    assert.ok(categories.rowCount >= 6);
    const categoryIds = categories.rows.map((row) => Number(row.id));

    const ruleResult = await db.query(`
      SELECT code, version, target_category_id
      FROM customer_classification_rules
      WHERE is_active = TRUE
        AND source_kind = 'RULE'
        AND confidence = 'HIGH'
        AND auto_approval_allowed = TRUE
      ORDER BY id
      LIMIT 1
    `);
    assert.equal(ruleResult.rowCount, 1);
    const rule = ruleResult.rows[0];

    await insertMembership(db, {
      productId,
      categoryId: categoryIds[0],
      assignmentSource: "EPC_FALLBACK",
      assignmentOrigin: "BACKFILL",
      confidence: "MEDIUM",
    });
    await insertMembership(db, {
      productId,
      categoryId: categoryIds[1],
      assignmentSource: "EPC_FALLBACK",
      assignmentOrigin: "IMPORT",
      confidence: "MEDIUM",
    });
    await insertMembership(db, {
      productId,
      categoryId: Number(rule.target_category_id),
      assignmentSource: "RULE",
      assignmentOrigin: "IMPORT",
      ruleCode: rule.code,
      ruleVersion: Number(rule.version),
      confidence: "HIGH",
    });

    await assertRejected(db, {
      productId,
      categoryId: categoryIds[2],
      assignmentSource: "EPC_FALLBACK",
      assignmentOrigin: "ADMIN",
      confidence: "MEDIUM",
    });
    await assertRejected(db, {
      productId,
      categoryId: categoryIds[3],
      assignmentSource: "EPC_FALLBACK",
      assignmentOrigin: "SYSTEM",
      confidence: "MEDIUM",
    });
    await assertRejected(db, {
      productId,
      categoryId: categoryIds[4],
      assignmentSource: "RULE",
      assignmentOrigin: "IMPORT",
      ruleCode: rule.code,
      ruleVersion: Number(rule.version),
      confidence: "MEDIUM",
    });
    await assertRejected(db, {
      productId,
      categoryId: categoryIds[5],
      assignmentSource: "EPC_FALLBACK",
      assignmentOrigin: "MIGRATION",
      confidence: "MEDIUM",
    });

    const existingViolations = await db.query(`
      SELECT COUNT(*)::integer AS count
      FROM product_customer_categories membership
      WHERE membership.approval_status = 'AUTO_APPROVED'
        AND NOT (
          (
            membership.assignment_source = 'RULE'
            AND membership.confidence = 'HIGH'
            AND membership.rule_code IS NOT NULL
          )
          OR (
            membership.assignment_source = 'EPC_FALLBACK'
            AND (
              (membership.confidence = 'HIGH' AND membership.rule_code IS NOT NULL)
              OR (
                membership.confidence = 'MEDIUM'
                AND membership.rule_code IS NULL
                AND membership.assignment_origin IN ('BACKFILL', 'IMPORT')
              )
            )
          )
        )
    `);
    assert.equal(existingViolations.rows[0].count, 0);

    await db.query("ROLLBACK");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
});
