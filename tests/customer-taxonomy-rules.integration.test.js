import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { pool } from "../src/config/db.js";
import { CustomerTaxonomyRepository } from "../src/repositories/CustomerTaxonomyRepository.js";
import {
  CUSTOMER_APPROVAL_STATUS,
  resolveCustomerTaxonomy,
} from "../src/services/CustomerTaxonomyResolver.js";

const phase2MigrationUrl = new URL(
  "../migrations/088_seed_customer_taxonomy_rules.sql",
  import.meta.url,
);
const categoryMigrationUrl = new URL(
  "../migrations/089_add_customer_taxonomy_batch2_categories.sql",
  import.meta.url,
);
const batch2MigrationUrl = new URL(
  "../migrations/090_seed_customer_taxonomy_batch2_rules.sql",
  import.meta.url,
);
const batch2CorrectionMigrationUrl = new URL(
  "../migrations/091_tighten_customer_taxonomy_batch2.sql",
  import.meta.url,
);
const safeTopLevelMigrationUrl = new URL(
  "../migrations/092_allow_safe_top_level_taxonomy_fallback.sql",
  import.meta.url,
);
const phase2eCategoryMigrationUrl = new URL(
  "../migrations/093_add_customer_taxonomy_phase2e_categories.sql",
  import.meta.url,
);
const phase2eRuleMigrationUrl = new URL(
  "../migrations/094_seed_customer_taxonomy_phase2e_rules.sql",
  import.meta.url,
);
const phase2fCategoryMigrationUrl = new URL(
  "../migrations/095_add_customer_taxonomy_phase2f_categories.sql",
  import.meta.url,
);
const phase2fRuleMigrationUrl = new URL(
  "../migrations/096_seed_customer_taxonomy_phase2f_rules.sql",
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
  return result.proposals[0];
}

test("migrations seed only reviewed HIGH primary RULE definitions", async () => {
  const grouped = await pool.query(`
    SELECT parent.slug AS section, COUNT(*)::integer AS count
    FROM customer_classification_rules rule
    JOIN customer_categories leaf ON leaf.id = rule.target_category_id
    JOIN customer_categories parent ON parent.id = leaf.parent_id
    WHERE rule.is_active = TRUE
    GROUP BY parent.slug
    ORDER BY parent.slug
  `);
  assert.deepEqual(grouped.rows, [
    { section: "accessories", count: 103 },
    { section: "brakes", count: 9 },
    { section: "climate", count: 9 },
    { section: "cooling", count: 10 },
    { section: "engine", count: 34 },
    { section: "exhaust", count: 12 },
    { section: "filters-maintenance", count: 14 },
    { section: "fuel-system", count: 9 },
    { section: "steering", count: 10 },
    { section: "suspension", count: 26 },
    { section: "transmission-drivetrain", count: 16 },
    { section: "wheels", count: 6 },
  ]);

  const invalid = await pool.query(`
    SELECT id
    FROM customer_classification_rules
    WHERE is_active = TRUE
      AND (detector_version <> 6
       OR source_kind <> 'RULE'
       OR assignment_role <> 'PRIMARY'
       OR confidence <> 'HIGH'
       OR auto_approval_allowed IS NOT TRUE
      )
  `);
  assert.equal(invalid.rowCount, 0);

  const versions = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE version = 1 AND detector_version = 2 AND is_active = FALSE
      )::integer AS historical_v1_d2,
      COUNT(*) FILTER (
        WHERE version = 2 AND detector_version = 3 AND is_active = FALSE
      )::integer AS historical_v2_d3,
      COUNT(*) FILTER (
        WHERE version = 1 AND detector_version = 3 AND is_active = FALSE
      )::integer AS historical_v1_d3,
      COUNT(*) FILTER (
        WHERE detector_version = 4 AND is_active = FALSE
      )::integer AS historical_d4,
      COUNT(*) FILTER (
        WHERE detector_version = 5 AND is_active = FALSE
      )::integer AS historical_d5,
      COUNT(*) FILTER (
        WHERE detector_version = 6 AND is_active = TRUE
          AND version > 1
      )::integer AS active_v6_successors,
      COUNT(*) FILTER (
        WHERE detector_version = 6 AND is_active = TRUE
          AND version = 1
          AND code LIKE '%PHASE2F_V1'
      )::integer AS new_phase2f_v1_d6,
      COUNT(*) FILTER (WHERE is_active = TRUE)::integer AS active_total,
      COUNT(*)::integer AS total
    FROM customer_classification_rules
  `);
  assert.deepEqual(versions.rows[0], {
    historical_v1_d2: 119,
    historical_v2_d3: 119,
    historical_v1_d3: 25,
    historical_d4: 146,
    historical_d5: 192,
    active_v6_successors: 192,
    new_phase2f_v1_d6: 66,
    active_total: 258,
    total: 859,
  });

  const versionDrift = await pool.query(`
    SELECT historical.code
    FROM customer_classification_rules historical
    JOIN customer_classification_rules active
      ON active.code = historical.code
     AND active.version = historical.version + 1
     AND active.detector_version = 6
     AND active.is_active = TRUE
    WHERE historical.detector_version = 5
      AND (
        active.source_kind IS DISTINCT FROM historical.source_kind
        OR active.assignment_role IS DISTINCT FROM historical.assignment_role
        OR active.number_family IS DISTINCT FROM historical.number_family
        OR active.epc_group IS DISTINCT FROM historical.epc_group
        OR active.match_type IS DISTINCT FROM historical.match_type
        OR active.match_value IS DISTINCT FROM historical.match_value
        OR active.exclude_values IS DISTINCT FROM historical.exclude_values
        OR active.target_category_id IS DISTINCT FROM historical.target_category_id
        OR active.priority IS DISTINCT FROM historical.priority
        OR active.confidence IS DISTINCT FROM historical.confidence
        OR active.auto_approval_allowed IS DISTINCT FROM historical.auto_approval_allowed
      )
  `);
  assert.equal(versionDrift.rowCount, 0);

  const multipleActive = await pool.query(`
    SELECT code
    FROM customer_classification_rules
    WHERE is_active = TRUE
    GROUP BY code
    HAVING COUNT(*) > 1
  `);
  assert.equal(multipleActive.rowCount, 0);

  const memberships = await pool.query(
    "SELECT COUNT(*)::integer AS count FROM product_customer_categories",
  );
  assert.equal(memberships.rows[0].count, 0);
});

test("taxonomy migrations are idempotent and cannot write memberships or old EPC tables", async () => {
  const phase2Sql = await readFile(phase2MigrationUrl, "utf8");
  const categorySql = await readFile(categoryMigrationUrl, "utf8");
  const batch2Sql = await readFile(batch2MigrationUrl, "utf8");
  const safeTopLevelSql = await readFile(safeTopLevelMigrationUrl, "utf8");
  const phase2eCategorySql = await readFile(phase2eCategoryMigrationUrl, "utf8");
  const phase2eRuleSql = await readFile(phase2eRuleMigrationUrl, "utf8");
  const phase2fCategorySql = await readFile(phase2fCategoryMigrationUrl, "utf8");
  const phase2fRuleSql = await readFile(phase2fRuleMigrationUrl, "utf8");
  for (const sql of [
    phase2Sql,
    categorySql,
    batch2Sql,
    safeTopLevelSql,
    phase2eCategorySql,
    phase2eRuleSql,
    phase2fCategorySql,
    phase2fRuleSql,
  ]) {
    assert.doesNotMatch(
      sql,
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:product_customer_categories|categories|product_categories|products)\b/iu,
    );
  }

  const beforeResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM customer_classification_rules) AS rules,
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS memberships,
      (SELECT COUNT(*)::integer FROM categories) AS epc_categories,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_memberships
  `);
  // Historical migrations are never replayed after a later detector generation.
  // Only the current PHASE 2F migrations must be idempotent at this point.
  await pool.query(phase2fCategorySql);
  await pool.query(phase2fRuleSql);
  const afterResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM customer_classification_rules) AS rules,
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS memberships,
      (SELECT COUNT(*)::integer FROM categories) AS epc_categories,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_memberships
  `);
  assert.deepEqual(afterResult.rows[0], beforeResult.rows[0]);
  assert.equal(afterResult.rows[0].rules, 859);
  assert.equal(afterResult.rows[0].memberships, 0);
});

test("inactive historical v1 membership remains valid and PHASE 2F migration replay does not rewrite it", async () => {
  const phase2fRuleSql = await readFile(phase2fRuleMigrationUrl, "utf8");
  const fixture = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Historical taxonomy membership', TRUE)
    RETURNING id
  `, [`HISTORY${process.pid}${Date.now()}`]);
  const productId = Number(fixture.rows[0].id);
  try {
    await pool.query(`
      INSERT INTO product_customer_categories(
        product_id, customer_category_id, is_primary,
        assignment_source, assignment_origin, rule_code, rule_version,
        confidence, approval_status, approved_at
      )
      SELECT $1, target_category_id, TRUE,
             'RULE', 'BACKFILL', code, version,
             'HIGH', 'AUTO_APPROVED', NOW()
      FROM customer_classification_rules
      WHERE code = 'FILTER_OIL_A_EPC18_V1'
        AND version = 1
        AND detector_version = 2
        AND is_active = FALSE
    `, [productId]);
    const beforeResult = await pool.query(`
      SELECT membership.rule_code, membership.rule_version,
             membership.updated_at, rule.is_active AS rule_active
      FROM product_customer_categories membership
      JOIN customer_classification_rules rule
        ON rule.code = membership.rule_code
       AND rule.version = membership.rule_version
      WHERE membership.product_id = $1
    `, [productId]);
    assert.deepEqual({
      ruleCode: beforeResult.rows[0].rule_code,
      ruleVersion: beforeResult.rows[0].rule_version,
      ruleActive: beforeResult.rows[0].rule_active,
    }, {
      ruleCode: "FILTER_OIL_A_EPC18_V1",
      ruleVersion: 1,
      ruleActive: false,
    });

    await pool.query(phase2fRuleSql);

    const afterResult = await pool.query(`
      SELECT membership.rule_code, membership.rule_version,
             membership.updated_at, rule.is_active AS rule_active
      FROM product_customer_categories membership
      JOIN customer_classification_rules rule
        ON rule.code = membership.rule_code
       AND rule.version = membership.rule_version
      WHERE membership.product_id = $1
    `, [productId]);
    assert.equal(afterResult.rowCount, 1);
    assert.equal(afterResult.rows[0].rule_code, beforeResult.rows[0].rule_code);
    assert.equal(afterResult.rows[0].rule_version, 1);
    assert.equal(afterResult.rows[0].rule_active, false);
    assert.deepEqual(afterResult.rows[0].updated_at, beforeResult.rows[0].updated_at);

    const verification = await CustomerTaxonomyRepository.getBackfillVerification(pool);
    assert.equal(verification.orphanRule, 0);
  } finally {
    await pool.query("DELETE FROM product_customer_categories WHERE product_id = $1", [productId]);
    await pool.query("DELETE FROM products WHERE id = $1", [productId]);
  }
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

test("resolver uses detector-v6 successors while PHASE 2F rules start at v1", () => {
  const historicalSuccessor = expectAutoApproved({
    article: "A0001800109",
    name: "Масляний фільтр",
    epc: "18",
  }, "filters-oil");
  assert.equal(historicalSuccessor.ruleVersion, 5);

  const newPhase2dRule = expectAutoApproved({
    article: "A0004600000",
    name: "Рейка рульова",
    epc: "46",
  }, "steering-racks");
  assert.equal(newPhase2dRule.ruleVersion, 4);
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
  expectAutoApproved({
    article: "A1772003400",
    name: "Натягувач ременя",
    epc: "20",
  }, "engine-belt-tensioners");
  assert.equal(resolve({
    article: "A2138200540",
    name: "Механізм склоочисника",
    epc: "82",
  }).proposals.length, 0);
  expectAutoApproved({
    article: "A212470065905",
    name: "AKTIVKOHLEFILTER",
    epc: "47",
  }, "fuel-vapor-canisters");
  expectAutoApproved({
    article: "A2214700759",
    name: "AKTKOHLEFILTER",
    epc: "47",
  }, "fuel-vapor-canisters");
  expectAutoApproved({
    article: "A1770940004",
    name: "Рамка повітряного фільтра",
    epc: "09",
  }, "engine-air-filter-housings");
  assert.equal(resolve({
    article: "A4478351600",
    name: "Комплект фільтрів (паливний+масляний+повітряний)",
    epc: "83",
  }).proposals.length, 0);
  expectAutoApproved({
    article: "A0002770000",
    name: "Фільтр мастила АКПП",
    epc: "27",
  }, "transmission-oil-filters");
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

test("reviewed steering EPC and TYPE_CODE combinations resolve to PHASE 2D leaves", () => {
  expectAutoApproved({
    article: "A0004600001",
    name: "Рейка кермова",
    epc: "46",
  }, "steering-racks");
  expectAutoApproved({
    article: "A0003300001",
    name: "Тяга рульова",
    epc: "33",
  }, "steering-tie-rods");
  expectAutoApproved({
    article: "A0003386110",
    name: "Наконечник",
    epc: "33",
  }, "steering-tie-rod-ends");
  expectAutoApproved({
    article: "A0004600002",
    name: "Насос ГУР",
    epc: "46",
  }, "steering-pumps");
  expectAutoApproved({
    article: "A0004600003",
    name: "Вал рульовий",
    epc: "46",
  }, "steering-shafts");
  expectAutoApproved({
    article: "A0004600004",
    name: "Бачок рульового керування",
    epc: "46",
  }, "steering-reservoirs");
  expectAutoApproved({
    article: "A0004600005",
    name: "Шланг рульового керування",
    epc: "46",
  }, "steering-hoses-pipes");
});

test("steering generic parts outside reviewed EPC context remain unclassified", () => {
  for (const input of [{
    article: "A0003200001",
    name: "Тяга стабілізатора",
    epc: "32",
  }, {
    article: "A0002000001",
    name: "Насос охолоджувальної рідини",
    epc: "20",
  }, {
    article: "A0002700001",
    name: "Вал коробки передач",
    epc: "27",
  }]) {
    assert.equal(resolve(input).proposals.length, 0);
  }
});

test("reviewed exhaust EPC and TYPE_CODE combinations resolve to PHASE 2D leaves", () => {
  expectAutoApproved({
    article: "A0004900001",
    name: "Каталізатор вихлопної системи",
    epc: "49",
  }, "exhaust-catalysts");
  expectAutoApproved({
    article: "A0004900002",
    name: "Глушник",
    epc: "49",
  }, "exhaust-mufflers");
  expectAutoApproved({
    article: "A0004900003",
    name: "Труба глушника",
    epc: "49",
  }, "exhaust-pipes");
  expectAutoApproved({
    article: "A0009000001",
    name: "Датчик тиску вихлопних газів",
    epc: "90",
  }, "exhaust-sensors");
  expectAutoApproved({
    article: "A0004900004",
    name: "Кронштейн вихлопної системи",
    epc: "49",
  }, "exhaust-mounts");
  expectAutoApproved({
    article: "A0004900005",
    name: "Форсунка AdBlue",
    epc: "49",
  }, "exhaust-adblue-scr");
  expectAutoApproved({
    article: "A6541405600",
    name: "Патрубок рециркуляції вихлопних газів",
    epc: "14",
  }, "exhaust-egr");
});

test("rubber muffler hangers resolve as mounts and never as complete mufflers", () => {
  for (const input of [{
    article: "A3814920082",
    name: "Гумка глушителя",
    epc: "49",
  }, {
    article: "A1644920944",
    name: "Резинка глушителя",
    epc: "49",
  }, {
    article: "A0004920000",
    name: "Rubber exhaust hanger",
    epc: "49",
  }]) {
    const result = resolve(input);
    assert.equal(result.typeCodes.includes("EXHAUST_MOUNT"), true);
    assert.equal(result.typeCodes.includes("EXHAUST_MUFFLER"), false);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0].category.slug, "exhaust-mounts");
  }

  const muffler = expectAutoApproved({
    article: "A4634904521",
    name: "Глушитель",
    epc: "49",
  }, "exhaust-mufflers");
  assert.equal(muffler.ruleVersion, 4);
});

test("generic sensors, pipes and muffler components do not become complete exhaust parts", () => {
  for (const input of [{
    article: "A0001800001",
    name: "Датчик тиску оливи",
    epc: "18",
  }, {
    article: "A0004700001",
    name: "Трубка паливна",
    epc: "47",
  }, {
    article: "A0004900006",
    name: "Прокладка глушника",
    epc: "49",
  }]) {
    const result = resolve(input);
    assert.equal(result.proposals.some(({ category }) => [
      "exhaust-catalysts",
      "exhaust-mufflers",
      "exhaust-pipes",
    ].includes(category.slug)), false);
  }
});

test("reviewed wheel EPC and TYPE_CODE combinations resolve to PHASE 2D leaves", () => {
  expectAutoApproved({
    article: "A0004000001",
    name: "Диск колісний легкосплавний",
    epc: "40",
  }, "wheels-rims");
  expectAutoApproved({
    article: "A00040009009790",
    name: "Ковпак колеса",
    epc: "40",
  }, "wheels-caps");
  expectAutoApproved({
    article: "A000401060964",
    name: "Ковпак ніпеля колеса",
    epc: "40",
  }, "wheels-valve-caps");
  expectAutoApproved({
    article: "A0004000002",
    name: "Болт колісний",
    epc: "40",
  }, "wheels-bolts-nuts");
  expectAutoApproved({
    article: "A0009000002",
    name: "Датчик тиску в шині",
    epc: "90",
  }, "wheels-pressure-sensors");
});

test("wheel cover semantics do not collapse valve and spare-wheel covers into rim caps", () => {
  const center = resolve({
    article: "A00040038009283",
    name: "Ковпак ступиці",
    epc: "40",
  });
  assert.deepEqual(center.typeCodes.filter((typeCode) => typeCode.startsWith("WHEEL_")), [
    "WHEEL_CENTER_CAP",
  ]);
  assert.equal(center.proposals[0].category.slug, "wheels-caps");

  const valve = resolve({
    article: "A0004018519",
    name: "Ковпачок ніпеля",
    epc: "40",
  });
  assert.equal(valve.typeCodes.includes("WHEEL_CENTER_CAP"), false);
  assert.equal(valve.typeCodes.includes("WHEEL_VALVE_CAP"), true);
  assert.equal(valve.proposals[0].category.slug, "wheels-valve-caps");

  const spare = resolve({
    article: "A6394030244",
    name: "Кришка запасного колеса",
    epc: "40",
  });
  assert.equal(spare.typeCodes.includes("WHEEL_CENTER_CAP"), false);
  assert.equal(spare.typeCodes.includes("WHEEL_SPARE_COVER"), true);
  assert.equal(spare.proposals.length, 0);
});

test("brake discs and unrelated pressure sensors stay outside wheel leaves", () => {
  assert.equal(resolve({
    article: "A0004200001",
    name: "Диск гальмівний",
    epc: "42",
  }).proposals.some((proposal) => proposal.category.parentSlug === "wheels"), false);
  assert.equal(resolve({
    article: "A0009000003",
    name: "Датчик тиску палива",
    epc: "90",
  }).proposals.some((proposal) => proposal.category.parentSlug === "wheels"), false);
  assert.equal(resolve({
    article: "A0004000003",
    name: "Гайка вентиля",
    epc: "40",
  }).proposals.some((proposal) => proposal.category.parentSlug === "wheels"), false);
});

test("reviewed PHASE 2E EPC and TYPE_CODE combinations resolve to exact leaves", () => {
  const cases = [
    [{ article: "A0002500515", name: "Вижимний", epc: "25" }, "transmission-clutch-components"],
    [{ article: "A1402770095", name: "Фільтр мастила", epc: "27" }, "transmission-oil-filters"],
    [{ article: "A271078112380", name: "Форсунка паливна", epc: "07" }, "fuel-injectors"],
    [{ article: "A212470065905", name: "Фільтр з активним вугіллям", epc: "47" }, "fuel-vapor-canisters"],
    [{ article: "A0005000801", name: "Насос системи охолодження", epc: "50" }, "cooling-water-pumps"],
    [{ article: "A0995005903", name: "Радіатор системи охолодження", epc: "50" }, "cooling-radiators"],
    [{ article: "A2215000754", name: "Конденсатор кондиціонера", epc: "50" }, "climate-condensers"],
    [{ article: "A2208300772", name: "Датчик температури випаровуваля", epc: "83" }, "climate-sensors"],
    [{ article: "A0004700400", name: "Насос AdBlue", epc: "47" }, "exhaust-adblue-scr"],
    [{ article: "A1668307401", name: "Комплект фільтрів повітря салону", epc: "83" }, "filters-cabin"],
  ];
  for (const [input, slug] of cases) expectAutoApproved(input, slug);
});

test("reviewed PHASE 2F engine and suspension products resolve only with exact EPC evidence", () => {
  const cases = [
    [{ article: "A0002020719", name: "Ролик натяжний", epc: "20" }, "engine-belt-tensioners"],
    [{ article: "A1020520483", name: "Накладка на башмак", epc: "05" }, "engine-timing-components"],
    [{ article: "A1132200048", name: "Подушка двигуна", epc: "22" }, "engine-mounts"],
    [{ article: "A1780901000", name: "Повітровід", epc: "09" }, "engine-intake-air-ducts"],
    [{ article: "A000323158564", name: "Втулка амортизатора", epc: "32" }, "suspension-shock-absorbers"],
    [{ article: "A1643303407", name: "Важiль підвіски", epc: "33" }, "suspension-control-arms"],
    [{ article: "A1663340206", name: "Маточина колеса", epc: "33" }, "suspension-wheel-bearings-hubs"],
  ];
  for (const [input, slug] of cases) expectAutoApproved(input, slug);
});

test("PHASE 2F reviewed ambiguity remains out of narrow automatic leaves", () => {
  for (const input of [
    { article: "A0002021619", name: "Ролик", epc: "20" },
    { article: "A1121412180", name: "Прокладка", epc: "14" },
    { article: "A1662400618", name: "Подушка АКПП", epc: "24" },
    { article: "A0003301719", name: "Рем.комплект шворня поворотного", epc: "33" },
    { article: "A1673380000", name: "Тяга", epc: "33" },
    { article: "A0003330771", name: "Болт металевий", epc: "33" },
  ]) {
    const result = resolve(input);
    assert.equal(result.proposals.length, 0, input.article);
    assert.equal(result.unclassified, true, input.article);
  }
});

test("PHASE 2F preserves reviewed cross-section filter, cooling and steering targets", () => {
  expectAutoApproved({
    article: "A0000903751",
    name: "Фільтр повітряний двигуна",
    epc: "09",
  }, "filters-engine-air");
  expectAutoApproved({
    article: "A112200150180",
    name: "Помпа водяна",
    epc: "20",
  }, "cooling-water-pumps");
  expectAutoApproved({
    article: "A0003386110",
    name: "Наконечник",
    epc: "33",
  }, "steering-tie-rod-ends");
});

test("split EPC groups never auto-approve generic names", () => {
  for (const input of [
    { article: "A0000700000", name: "Датчик", epc: "07" },
    { article: "A0004700000", name: "Кронштейн", epc: "47" },
    { article: "A0005000000", name: "Трубка", epc: "50" },
    { article: "A0008300000", name: "Мотор", epc: "83" },
  ]) {
    assert.equal(resolve(input).proposals.length, 0, input.article);
  }
});

test("detector v6 preserves every detector-v5 classification target without writes", async () => {
  const products = await CustomerTaxonomyRepository.listProductsForPreview(pool);
  const historicalResult = await pool.query(`
    SELECT
      rule.*,
      category.slug AS target_category_slug,
      category.parent_id AS target_parent_id,
      category.status AS target_status,
      category.is_active AS target_is_active,
      parent.slug AS target_parent_slug
    FROM customer_classification_rules rule
    JOIN customer_categories category ON category.id = rule.target_category_id
    LEFT JOIN customer_categories parent ON parent.id = category.parent_id
    WHERE rule.detector_version = 5
  `);
  const historicalRulesUnderCurrentDetector = historicalResult.rows.map((rule) => ({
    ...rule,
    detector_version: 6,
    is_active: true,
  }));
  const baseline = new Map();

  for (const product of products) {
    const historicalResolution = resolveCustomerTaxonomy({
      product,
      rules: historicalRulesUnderCurrentDetector,
      existingMemberships: [],
    });
    const historicalPrimary = historicalResolution.proposals.find((proposal) => (
      proposal.isPrimary
    ));
    if (historicalPrimary) baseline.set(product.id, historicalPrimary.category.slug);

    const currentResolution = resolveCustomerTaxonomy({
      product,
      rules,
      existingMemberships: [],
    });
    const currentPrimary = currentResolution.proposals.find((proposal) => proposal.isPrimary);
    if (historicalPrimary) {
      assert.equal(currentPrimary?.category?.slug, historicalPrimary.category.slug, product.article);
    }
  }

  assert.ok(baseline.size > 0);

  const membershipCount = await pool.query(
    "SELECT COUNT(*)::integer AS count FROM product_customer_categories",
  );
  assert.equal(membershipCount.rows[0].count, 0);
});
