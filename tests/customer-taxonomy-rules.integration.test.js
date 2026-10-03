import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pool } from "../src/config/db.js";
import { CustomerTaxonomyRepository } from "../src/repositories/CustomerTaxonomyRepository.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  resolveCustomerTaxonomy,
} from "../src/services/CustomerTaxonomyResolver.js";

const migrationUrl = new URL(
  "../migrations/088_seed_customer_taxonomy_rules.sql",
  import.meta.url,
);
let rules = [];

before(async () => {
  rules = await CustomerTaxonomyRepository.listActiveRules(pool);
});

after(async () => {
  await pool.end();
});

function resolve({ article, name, epc = [] }) {
  return resolveCustomerTaxonomy({
    product: {
      article,
      articleNormalized: article.replace(/[^A-Z0-9]/gi, "").toUpperCase(),
      name,
      technicalEpcGroups: Array.isArray(epc) ? epc : [epc],
    },
    rules,
    existingMemberships: [],
  });
}

function expectAutoApproved(input, expectedSlug) {
  const result = resolve(input);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].category.slug, expectedSlug);
  assert.equal(
    result.proposals[0].approvalStatus,
    CUSTOMER_APPROVAL_STATUS.AUTO_APPROVED,
  );
  assert.equal(result.proposals[0].isPrimary, true);
}

test("migration 088 seeds only reviewed HIGH primary RULE definitions", async () => {
  const grouped = await pool.query(`
    SELECT parent.slug AS section, COUNT(*)::integer AS count
    FROM customer_classification_rules rule
    JOIN customer_categories leaf ON leaf.id = rule.target_category_id
    JOIN customer_categories parent ON parent.id = leaf.parent_id
    GROUP BY parent.slug
    ORDER BY parent.slug
  `);
  assert.deepEqual(grouped.rows, [
    { section: "accessories", count: 103 },
    { section: "brakes", count: 9 },
    { section: "filters-maintenance", count: 7 },
  ]);

  const invalid = await pool.query(`
    SELECT id
    FROM customer_classification_rules
    WHERE version <> 1
       OR detector_version <> 2
       OR source_kind <> 'RULE'
       OR assignment_role <> 'PRIMARY'
       OR confidence <> 'HIGH'
       OR auto_approval_allowed IS NOT TRUE
       OR is_active IS NOT TRUE
  `);
  assert.equal(invalid.rowCount, 0);

  const memberships = await pool.query(
    "SELECT COUNT(*)::integer AS count FROM product_customer_categories",
  );
  assert.equal(memberships.rows[0].count, 0);
});

test("migration 088 is idempotent and cannot write memberships or old EPC tables", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:product_customer_categories|categories|product_categories|products)\b/iu,
  );

  const beforeResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM customer_classification_rules) AS rules,
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS memberships,
      (SELECT COUNT(*)::integer FROM categories) AS epc_categories,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_memberships
  `);
  await pool.query(sql);
  const afterResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM customer_classification_rules) AS rules,
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS memberships,
      (SELECT COUNT(*)::integer FROM categories) AS epc_categories,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_memberships
  `);
  assert.deepEqual(afterResult.rows[0], beforeResult.rows[0]);
  assert.equal(afterResult.rows[0].rules, 119);
  assert.equal(afterResult.rows[0].memberships, 0);
});

test("reviewed filter EPC and TYPE_CODE combinations resolve to READY leaves", () => {
  expectAutoApproved({
    article: "A0001800109",
    name: "Масляний фільтр",
    epc: "18",
  }, "filters-oil");
  expectAutoApproved({
    article: "A0000903751",
    name: "Фільтр повітряний двигуна",
    epc: "09",
  }, "filters-engine-air");
  expectAutoApproved({
    article: "A0008351500",
    name: "Фільтр повітря салону",
    epc: "83",
  }, "filters-cabin");
  expectAutoApproved({
    article: "A0024776101",
    name: "Фільтр паливний",
    epc: "47",
  }, "filters-fuel");
  expectAutoApproved({
    article: "A0001590500",
    name: "Свічка запалення",
    epc: "15",
  }, "filters-spark-ignition");
  expectAutoApproved({
    article: "A0018206145",
    name: "Щітка склоочисника",
    epc: "82",
  }, "filters-wipers");
});

test("unsafe filter contexts, belt tensioners and wiper mechanisms are not auto-approved", () => {
  assert.equal(resolve({
    article: "A0000900000",
    name: "Фільтр паливний",
    epc: "09",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A0009933900",
    name: "Ремінь",
    epc: "99",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A1772003400",
    name: "Натягувач ременя",
    epc: "20",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A2138200540",
    name: "Механізм склоочисника",
    epc: "82",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A212470065905",
    name: "AKTIVKOHLEFILTER",
    epc: "47",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A2214700759",
    name: "AKTKOHLEFILTER",
    epc: "47",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A1770940004",
    name: "Рамка повітряного фільтра",
    epc: "09",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A4478351600",
    name: "Комплект фільтрів (паливний+масляний+повітряний)",
    epc: "83",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A0002770000",
    name: "Фільтр мастила АКПП",
    epc: "27",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A0003200000",
    name: "Гідравлічний фільтр",
    epc: "32",
  }).proposals.length, 0);
});

test("service filter leaves require matching item semantics and EPC context", () => {
  expectAutoApproved({
    article: "A0024776101",
    name: "Фільтр паливний",
    epc: "47",
  }, "filters-fuel");
  expectAutoApproved({
    article: "A0001800109",
    name: "Фільтр оливи",
    epc: "18",
  }, "filters-oil");
  expectAutoApproved({
    article: "A2730901201",
    name: "Фільтр повітряний двигуна",
    epc: "09",
  }, "filters-engine-air");
  expectAutoApproved({
    article: "A0008351500",
    name: "Фільтр повітряний салону",
    epc: "83",
  }, "filters-cabin");
});

test("disc shields and caliper components stay outside complete-part leaves", () => {
  assert.equal(resolve({
    article: "A1674233100",
    name: "Захист гальмівного диску",
    epc: "42",
  }).proposals.length, 0);
  assert.equal(resolve({
    article: "A0004210850",
    name: "Направляюча супорта, комплект",
    epc: "42",
  }).proposals.length, 0);
});

test("reviewed brake EPC and TYPE_CODE combinations resolve to READY leaves", () => {
  expectAutoApproved({
    article: "A000420020590",
    name: "Колодки гальмівні",
    epc: "42",
  }, "brakes-pads");
  expectAutoApproved({
    article: "A2214211312",
    name: "Диск гальмівний",
    epc: "42",
  }, "brakes-discs");
  expectAutoApproved({
    article: "A1674217700",
    name: "Супорт гальмівний",
    epc: "42",
  }, "brakes-calipers");
  expectAutoApproved({
    article: "A0009050000",
    name: "Датчик гальмівної системи",
    epc: "90",
  }, "brakes-sensors");
  expectAutoApproved({
    article: "A4474301229",
    name: "Трубопровід гальмівної системи",
    epc: "43",
  }, "brakes-hoses-pipes");
  expectAutoApproved({
    article: "A0004300000",
    name: "Головний гальмівний циліндр",
    epc: "43",
  }, "brakes-master-cylinders");
});

test("generic spring in brake EPC gets no customer leaf", () => {
  const result = resolve({
    article: "A0004211501",
    name: "Пружина розтискна",
    epc: "42",
  });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.unclassified, true);
});

test("confirmed accessory exact/prefix rules work while arbitrary B stays unclassified", () => {
  expectAutoApproved({
    article: "A1666804102687M31",
    name: "Килимок підлоговий",
    epc: "68",
  }, "accessories-floor-mats");
  expectAutoApproved({
    article: "B66040640",
    name: "Моделька автомобіля 1:18",
  }, "accessories-collection");
  expectAutoApproved({
    article: "B67875707",
    name: "Динамік",
  }, "accessories-multimedia");

  const arbitrary = resolve({
    article: "B69999999",
    name: "Невідома деталь",
  });
  assert.equal(arbitrary.proposals.length, 0);
  assert.equal(arbitrary.unclassified, true);
});
