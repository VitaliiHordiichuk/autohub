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
    { section: "exhaust", count: 11 },
    { section: "filters-maintenance", count: 7 },
    { section: "steering", count: 10 },
    { section: "wheels", count: 6 },
  ]);

  const invalid = await pool.query(`
    SELECT id
    FROM customer_classification_rules
    WHERE is_active = TRUE
      AND (detector_version <> 4
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
        WHERE version = 3 AND detector_version = 4 AND is_active = TRUE
      )::integer AS active_v3_d4,
      COUNT(*) FILTER (
        WHERE version = 2 AND detector_version = 4 AND is_active = TRUE
      )::integer AS active_v2_d4,
      COUNT(*) FILTER (
        WHERE version = 1 AND detector_version = 4 AND is_active = TRUE
      )::integer AS new_v1_d4,
      COUNT(*) FILTER (WHERE is_active = TRUE)::integer AS active_total,
      COUNT(*)::integer AS total
    FROM customer_classification_rules
  `);
  assert.deepEqual(versions.rows[0], {
    historical_v1_d2: 119,
    historical_v2_d3: 119,
    historical_v1_d3: 25,
    active_v3_d4: 119,
    active_v2_d4: 24,
    new_v1_d4: 3,
    active_total: 146,
    total: 409,
  });

  const versionDrift = await pool.query(`
    SELECT historical.code
    FROM customer_classification_rules historical
    JOIN customer_classification_rules active
      ON active.code = historical.code
     AND active.version = historical.version + 1
     AND active.detector_version = 4
     AND active.is_active = TRUE
    WHERE historical.detector_version = 3
      AND historical.code <> 'WHEEL_CAP_A_EPC40_V1'
      AND (
        active.source_kind IS DISTINCT FROM historical.source_kind
        OR active.assignment_role IS DISTINCT FROM historical.assignment_role
        OR active.number_family IS DISTINCT FROM historical.number_family
        OR active.epc_group IS DISTINCT FROM historical.epc_group
        OR active.match_type IS DISTINCT FROM historical.match_type
        OR active.match_value IS DISTINCT FROM historical.match_value
        OR active.exclude_values IS DISTINCT FROM historical.exclude_values
        OR (
          historical.code <> 'EXHAUST_ADBLUE_INJECTOR_A_EPC49_V1'
          AND active.target_category_id IS DISTINCT FROM historical.target_category_id
        )
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

test("batch 2 migrations are idempotent and cannot write memberships or old EPC tables", async () => {
  const phase2Sql = await readFile(phase2MigrationUrl, "utf8");
  const categorySql = await readFile(categoryMigrationUrl, "utf8");
  const batch2Sql = await readFile(batch2MigrationUrl, "utf8");
  const correctionSql = await readFile(batch2CorrectionMigrationUrl, "utf8");
  const safeTopLevelSql = await readFile(safeTopLevelMigrationUrl, "utf8");
  for (const sql of [phase2Sql, categorySql, batch2Sql, correctionSql, safeTopLevelSql]) {
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
  await pool.query(correctionSql);
  await pool.query(safeTopLevelSql);
  const afterResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM customer_classification_rules) AS rules,
      (SELECT COUNT(*)::integer FROM product_customer_categories) AS memberships,
      (SELECT COUNT(*)::integer FROM categories) AS epc_categories,
      (SELECT COUNT(*)::integer FROM product_categories) AS epc_memberships
  `);
  assert.deepEqual(afterResult.rows[0], beforeResult.rows[0]);
  assert.equal(afterResult.rows[0].rules, 409);
  assert.equal(afterResult.rows[0].memberships, 0);
});

test("inactive historical v1 membership remains valid and migration replay does not rewrite it", async () => {
  const correctionSql = await readFile(batch2CorrectionMigrationUrl, "utf8");
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

    await pool.query(correctionSql);

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

test("resolver uses detector-v4 successors while new correction rules start at v1", () => {
  const historicalSuccessor = expectAutoApproved({
    article: "A0001800109",
    name: "Масляний фільтр",
    epc: "18",
  }, "filters-oil");
  assert.equal(historicalSuccessor.ruleVersion, 3);

  const newPhase2dRule = expectAutoApproved({
    article: "A0004600000",
    name: "Рейка рульова",
    epc: "46",
  }, "steering-racks");
  assert.equal(newPhase2dRule.ruleVersion, 2);
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
  assert.equal(muffler.ruleVersion, 2);
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
    assert.equal(resolve(input).proposals.length, 0);
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

test("detector v4 preserves every existing classification target without writes", async () => {
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
    WHERE rule.detector_version = 3
      AND parent.slug IN ('filters-maintenance', 'brakes', 'accessories')
  `);
  const historicalRulesUnderCurrentDetector = historicalResult.rows.map((rule) => ({
    ...rule,
    detector_version: 4,
    is_active: true,
  }));
  const existingSections = new Set(["filters-maintenance", "brakes", "accessories"]);
  const baseline = new Map();
  const current = new Map();

  for (const product of products) {
    const historicalResolution = resolveCustomerTaxonomy({
      product,
      rules: historicalRulesUnderCurrentDetector,
      existingMemberships: [],
    });
    const historicalPrimary = historicalResolution.proposals.find((proposal) => (
      proposal.isPrimary && existingSections.has(proposal.category.parentSlug)
    ));
    if (historicalPrimary) baseline.set(product.id, historicalPrimary.category.slug);

    const currentResolution = resolveCustomerTaxonomy({
      product,
      rules,
      existingMemberships: [],
    });
    const currentPrimary = currentResolution.proposals.find((proposal) => (
      proposal.isPrimary && existingSections.has(proposal.category.parentSlug)
    ));
    if (currentPrimary) current.set(product.id, currentPrimary.category.slug);
  }

  assert.ok(baseline.size > 0);
  assert.equal(current.size, baseline.size);
  const drift = [...baseline].filter(([productId, categorySlug]) => (
    current.get(productId) !== categorySlug
  ));
  assert.deepEqual(drift, []);

  const membershipCount = await pool.query(
    "SELECT COUNT(*)::integer AS count FROM product_customer_categories",
  );
  assert.equal(membershipCount.rows[0].count, 0);
});
