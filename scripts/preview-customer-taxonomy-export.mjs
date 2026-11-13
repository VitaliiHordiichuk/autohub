import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CustomerTaxonomyImportService } from "../src/services/CustomerTaxonomyImportService.js";
import { requiresOemVerificationBeforeBackfill } from "../src/services/CustomerTaxonomyUncategorizedBackfillService.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.argv[2];
const outputDirectory = process.argv[3]
  || path.resolve(projectRoot, "../artifacts/customer-taxonomy-production-preview");
if (!sourcePath) {
  throw new Error("Usage: node scripts/preview-customer-taxonomy-export.mjs <catalog-taxonomy.csv> [output-dir]");
}

function decodeExport(csvText) {
  const lines = csvText.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
  if (lines.shift() !== "record_type,data") throw new Error("Unexpected export CSV header");
  const result = { product: [], rule: [], category: [] };
  for (const [offset, line] of lines.entries()) {
    const comma = line.indexOf(",");
    const kind = line.slice(0, comma);
    const quoted = line.slice(comma + 1);
    if (!Object.hasOwn(result, kind) || comma < 0
      || !quoted.startsWith('"') || !quoted.endsWith('"')) {
      throw new Error(`Invalid export record at line ${offset + 2}`);
    }
    result[kind].push(JSON.parse(quoted.slice(1, -1).replaceAll('""', '"')));
  }
  if (result.product.length !== 1146 || result.rule.length !== 374
    || result.category.length !== 182) {
    throw new Error(`Unexpected source counts: ${JSON.stringify(Object.fromEntries(
      Object.entries(result).map(([kind, rows]) => [kind, rows.length]),
    ))}`);
  }
  return result;
}

function restoreProduct(row) {
  const groups = new Set();
  const article = String(row.articleNormalized || row.article || "");
  if (/^A[0-9]{10}/.test(article)) groups.add(article.slice(4, 6));
  for (const category of row.technicalCategories || []) {
    const match = String(category.slug || "").match(/^mb-group-(\d{2})$/i);
    if (match) groups.add(match[1]);
  }
  return {
    id: Number(row.id),
    article: row.article,
    articleNormalized: row.articleNormalized,
    name: row.name,
    brandId: row.brandId === null ? null : Number(row.brandId),
    brandName: row.brandName || null,
    isActive: true,
    translations: row.translations || [],
    technicalCategories: row.technicalCategories || [],
    technicalEpcGroups: [...groups].sort(),
    memberships: row.memberships || [],
  };
}

function restoreRule(row, categories) {
  const category = categories.get(Number(row.target_category_id));
  if (!category || category.slug !== row.targetCategorySlug) {
    throw new Error(`Rule ${row.code} has an unresolvable target category`);
  }
  const parent = category.parentId === null ? null : categories.get(category.parentId);
  if ((parent?.slug || null) !== (row.targetParentSlug || null)) {
    throw new Error(`Rule ${row.code} has a mismatched parent category`);
  }
  return {
    id: Number(row.id),
    code: row.code,
    version: Number(row.version),
    detectorVersion: Number(row.detector_version),
    sourceKind: row.source_kind,
    assignmentRole: row.assignment_role,
    numberFamily: row.number_family,
    epcGroup: row.epc_group,
    matchType: row.match_type,
    matchValue: row.match_value,
    excludeValues: row.exclude_values || [],
    targetCategoryId: category.id,
    targetCategorySlug: category.slug,
    targetParentId: category.parentId,
    targetParentSlug: parent?.slug || null,
    targetStatus: category.status,
    targetIsActive: category.isActive,
    priority: Number(row.priority),
    confidence: row.confidence,
    autoApprovalAllowed: row.auto_approval_allowed === true,
    isActive: row.is_active === true,
  };
}

function proposedRuleFromMigration(sql, categories, baselineRules) {
  const slug = sql.match(/WHERE slug = '([^']+)' AND status = 'ACTIVE'/)?.[1];
  const values = sql.match(/SELECT\s+'([^']+)',\s*(\d+),\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'\{\}'::TEXT\[\],\s*target\.id,\s*(\d+),\s*'([^']+)',\s*(TRUE|FALSE),\s*(TRUE|FALSE)\s*FROM target/s);
  if (!slug || !values || !sql.includes("118_add_explicit_engine_air_filter_epc47_rule")) {
    throw new Error("Migration 118 no longer matches the reviewed one-rule simulation");
  }
  const category = [...categories.values()].find((entry) => entry.slug === slug);
  const parent = categories.get(category?.parentId);
  if (!category || category.status !== "ACTIVE" || !category.isActive
    || !parent || baselineRules.some((rule) => rule.code === values[1])) {
    throw new Error("Migration 118 category/rule state conflicts with the production export");
  }
  return {
    id: Math.max(...baselineRules.map((rule) => rule.id)) + 1,
    code: values[1], version: Number(values[2]), detectorVersion: Number(values[3]),
    sourceKind: values[4], assignmentRole: values[5], numberFamily: values[6],
    epcGroup: values[7], matchType: values[8], matchValue: values[9],
    excludeValues: [], targetCategoryId: category.id, targetCategorySlug: category.slug,
    targetParentId: category.parentId, targetParentSlug: parent.slug,
    targetStatus: category.status, targetIsActive: category.isActive,
    priority: Number(values[10]), confidence: values[11],
    autoApprovalAllowed: values[12] === "TRUE", isActive: values[13] === "TRUE",
  };
}

function restoreMemberships(product, categories) {
  return product.memberships.map((row) => {
    const categoryId = Number(row.customerCategoryId ?? row.customer_category_id);
    const category = categories.get(categoryId);
    if (!category) throw new Error(`Product ${product.id} has an unknown category membership`);
    return {
      productId: product.id,
      customerCategoryId: categoryId,
      categorySlug: category.slug,
      parentSlug: categories.get(category.parentId)?.slug || null,
      isPrimary: row.isPrimary ?? row.is_primary,
      assignmentSource: row.assignmentSource ?? row.assignment_source,
      assignmentOrigin: row.assignmentOrigin ?? row.assignment_origin,
      ruleCode: row.ruleCode ?? row.rule_code,
      ruleVersion: row.ruleVersion ?? row.rule_version,
      confidence: row.confidence,
      approvalStatus: row.approvalStatus ?? row.approval_status,
    };
  });
}

function decisionFor(evaluation) {
  const { candidate, resolution, disposition } = evaluation;
  const possible = [...new Set((resolution.proposals || []).map((proposal) => proposal.category.slug))];
  const review = disposition.requiresReview || (resolution.conflicts || []).length > 0
    || (resolution.proposals || []).some((proposal) => proposal.approvalStatus === "REVIEW");
  const decision = candidate ? "AUTO" : review ? "REVIEW"
    : resolution.numberFamily === "OTHER" ? "UNSUPPORTED" : "UNCLASSIFIED";
  const proposal = candidate || (possible.length === 1 ? resolution.proposals[0] : null);
  const reason = disposition.reason || (resolution.conflicts || []).map((item) => item.reason).join(";")
    || (decision === "AUTO" ? "MATCHED_APPROVED_RULE" : decision === "REVIEW"
      ? "REVIEW_PROPOSAL" : decision === "UNSUPPORTED" ? "UNSUPPORTED_ARTICLE_FAMILY"
        : "NO_MATCHING_APPROVED_RULE");
  const flags = [];
  if (possible.length > 1) flags.push("MULTIPLE_PROPOSED_CATEGORIES");
  if ((resolution.conflicts || []).length) flags.push("RULE_CONFLICT");
  if (String(reason).includes("REAL_REVIEW")) flags.push("PRIOR_REAL_REVIEW");
  if (["SENSOR_HOLDER_NOT_SENSOR", "TIE_ROD_BOOT_NOT_ROD", "GENERIC_CLAMP_WITH_EPC_ONLY",
    "BUMPER_TRIM_CATEGORY_CONFLICT"].includes(reason)) flags.push(reason);
  if (review && !flags.length) flags.push("CONTEXT_REVIEW");
  if (candidate?.assignmentSource === "EPC_FALLBACK") flags.push("MEDIUM_ROOT_FALLBACK");
  const oemHold = requiresOemVerificationBeforeBackfill(evaluation.product.article);
  if (oemHold) flags.push("OEM_VERIFICATION_REQUIRED");
  return {
    decision,
    categoryId: proposal?.category.id ?? null,
    categorySlug: proposal?.category.slug || null,
    possibleCategories: possible,
    ruleCode: proposal?.ruleCode || null,
    ruleVersion: proposal?.ruleVersion ?? null,
    confidence: proposal?.confidence || null,
    source: candidate?.assignmentSource || (review ? "REVIEW" : "NONE"),
    reason,
    flags,
    detectedTypes: resolution.typeCodes || [],
    safeBackfill: decision === "AUTO" && candidate.assignmentSource === "RULE"
      && candidate.confidence === "HIGH" && candidate.approvalStatus === "AUTO_APPROVED"
      && !oemHold,
  };
}

function csvCell(value) {
  const string = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function csv(rows, headers) {
  return `${headers.join(",")}\n${rows.map((row) => headers.map((key) => csvCell(row[key])).join(",")).join("\n")}\n`;
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const label = key(item) || "(none)";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function markdownTable(counts, first, limit = 30) {
  return `| ${first} | Количество |\n|---|---:|\n${counts.slice(0, limit).map(([name, count]) => `| ${name.replaceAll("|", "\\|")} | ${count} |`).join("\n")}`;
}

const sourceText = await readFile(sourcePath, "utf8");
const exportData = decodeExport(sourceText);
const categories = new Map(exportData.category.map((row) => [Number(row.id), {
  id: Number(row.id), slug: row.slug, parentId: row.parent_id === null ? null : Number(row.parent_id),
  status: row.status, isActive: row.is_active === true,
}]));
if (categories.size !== 182) throw new Error("Duplicate category ids in export");
const categoryBySlug = new Map([...categories.values()].map((row) => [row.slug, row]));
if (categoryBySlug.size !== 182) throw new Error("Duplicate category slugs in export");
const products = exportData.product.map(restoreProduct).sort((a, b) => a.id - b.id);
if (new Set(products.map((row) => row.id)).size !== 1146) throw new Error("Duplicate product ids");
const newest = products.filter((row) => row.id >= 6654 && row.id <= 6755);
if (newest.length !== 102 || newest.some((row, index) => row.id !== 6654 + index)) {
  throw new Error("The complete 6654–6755 control cohort is not present");
}
const baselineRules = exportData.rule.map((row) => restoreRule(row, categories));
const migrationPath = path.join(projectRoot, "migrations/118_add_explicit_engine_air_filter_epc47_rule.sql");
const migrationSql = await readFile(migrationPath, "utf8");
const proposedRule = proposedRuleFromMigration(migrationSql, categories, baselineRules);
const scenarios = [baselineRules, [...baselineRules, proposedRule]];
const repository = { listCategoriesBySlugs: async () => {
  throw new Error("Category missing from the exported category map");
} };
const contexts = scenarios.map((rules) => ({ rules, categoryBySlug: new Map(categoryBySlug) }));
const rows = [];
for (const product of products) {
  const memberships = restoreMemberships(product, categories);
  const [baseline, proposed] = await Promise.all(contexts.map(async (context) => decisionFor(
    await CustomerTaxonomyImportService.evaluateProduct({ product, existingMemberships: memberships, context }, {
      db: {}, repository, assignmentOrigin: "BACKFILL",
    }),
  )));
  const translations = Object.fromEntries(product.translations.map((row) => [row.languageCode, row.name]));
  rows.push({
    productId: product.id, article: product.article, name: product.name,
    nameUk: translations.uk || "", nameRu: translations.ru || "", nameEn: translations.en || "",
    epcGroups: product.technicalEpcGroups.join(";"),
    detectedTypes: proposed.detectedTypes.join(";"),
    baselineDecision: baseline.decision, baselineCategoryId: baseline.categoryId,
    baselineCategorySlug: baseline.categorySlug, baselineRule: baseline.ruleCode,
    baselineConfidence: baseline.confidence, baselineSource: baseline.source,
    baselineReason: baseline.reason, baselineSafeBackfill: baseline.safeBackfill ? "YES" : "NO",
    proposedDecision: proposed.decision, proposedCategoryId: proposed.categoryId,
    proposedCategorySlug: proposed.categorySlug, proposedRule: proposed.ruleCode,
    proposedConfidence: proposed.confidence, proposedSource: proposed.source,
    proposedReason: proposed.reason, possibleCategories: proposed.possibleCategories.join(";"),
    ambiguityFlags: proposed.flags.join(";"), safeBackfill: proposed.safeBackfill ? "YES" : "NO",
    changed: JSON.stringify([baseline.decision, baseline.categorySlug, baseline.ruleCode])
      !== JSON.stringify([proposed.decision, proposed.categorySlug, proposed.ruleCode]) ? "YES" : "NO",
  });
}

for (const article of ["A2976709601", "A2946700400", "A2966701300"]) {
  const row = rows.find((item) => item.article === article);
  if (!row || row.proposedDecision !== "AUTO" || row.proposedCategorySlug !== "body-windshields") {
    throw new Error(`Windshield control failed: ${article}`);
  }
}
for (const article of ["A2226982201", "A0009053119"]) {
  const row = rows.find((item) => item.article === article);
  if (!row || row.proposedDecision === "AUTO" || !row.proposedReason.includes("REAL_REVIEW")) {
    throw new Error(`REAL_REVIEW control failed: ${article}`);
  }
}
const headers = Object.keys(rows[0]);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "all-products.csv"), csv(rows, headers)),
  writeFile(path.join(outputDirectory, "newest-102.csv"), csv(rows.filter((row) => row.productId >= 6654 && row.productId <= 6755), headers)),
  writeFile(path.join(outputDirectory, "review-required.csv"), csv(rows.filter((row) => (
    row.proposedDecision === "REVIEW" || (row.proposedDecision === "AUTO" && row.safeBackfill === "NO")
  )), headers)),
  writeFile(path.join(outputDirectory, "unclassified.csv"), csv(rows.filter((row) => ["UNCLASSIFIED", "UNSUPPORTED"].includes(row.proposedDecision)), headers)),
]);

const changed = rows.filter((row) => row.changed === "YES");
const flagged = rows.filter((row) => row.ambiguityFlags);
const controls = ["A2976709601", "A2946700400", "A2966701300", "A1679068510",
  "A1669068701", "A167885030764", "A2214700659", "A2226982201", "A0009053119"];
const controlRows = controls.map((article) => rows.find((row) => row.article === article));
if (controlRows.some((row) => !row)) throw new Error("Missing required control article in export");
const summary = `# MAKA: dry-run классификации production-экспорта

Источник: read-only CSV, SHA-256 \`${createHash("sha256").update(sourceText).digest("hex")}\`. Данные экспорта не изменялись. Моделирование выполнил действующий \`CustomerTaxonomyImportService.evaluateProduct\` с его \`CustomerTaxonomyResolver\` и \`CustomerProductTypeDetector\`; подключение к production отсутствовало.

## Полнота входных данных

- 1 146 активных товаров без утверждённой основной категории; контрольные ID 6654–6755: 102/102.
- 374 действующих правила и 182 категории, восстановленные по ID, slug, статусу и иерархии.
- Для каждого товара учтены артикул, исходное имя, переводы UK/RU/EN, технические категории EPC и текущие назначения (в экспорте их 0).
- В экспорте нет переводов названий самих категорий, поэтому отчёт использует проверяемые ID и slug, не придумывая отображаемые названия.
- Сценарий «374 правила» использует новый локальный код детектора; это сравнение состава правил, а не запуск старого production-кода.
- Миграция 104 сохранена без изменений. Локальная 116 совпадает с применённой миграцией МАКАТРОНа; номер 117 занят \`117_makatron_staff_orders_quotes\`. Новое правило вынесено в 118 и проверено на отдельной тестовой базе после 117.

## Решения

| Сценарий | AUTO | REVIEW | UNCLASSIFIED | UNSUPPORTED | HIGH RULE для безопасного backfill |
|---|---:|---:|---:|---:|---:|
${["baseline", "proposed"].map((key, index) => {
  const prefix = index === 0 ? "baseline" : "proposed";
  const counts = Object.fromEntries(countBy(rows, (row) => row[`${prefix}Decision`]));
  return `| ${index === 0 ? "374 правила" : "375 правил (миграция 118)"} | ${counts.AUTO || 0} | ${counts.REVIEW || 0} | ${counts.UNCLASSIFIED || 0} | ${counts.UNSUPPORTED || 0} | ${index === 0 ? rows.filter((row) => row.baselineSafeBackfill === "YES").length : rows.filter((row) => row.safeBackfill === "YES").length} |`;
}).join("\n")}

Изменившихся решений или правил: **${changed.length}**. \`AUTO\` включает существующий MEDIUM \`EPC_FALLBACK\`; к ограниченному backfill допустимы только строки \`safeBackfill=YES\` (HIGH RULE после консервативных проверок семантики). Три HIGH-кандидата с флагом \`OEM_VERIFICATION_REQUIRED\` не входят в план до отдельной проверки. Все остальные требуют подтверждения или остаются без категории. Никаких назначений этот dry-run не создаёт.

Операционное разделение всех 1 146 товаров: **${rows.filter((row) => row.safeBackfill === "YES").length}** кандидата для ограниченного backfill, **${rows.filter((row) => row.proposedDecision === "REVIEW" || (row.proposedDecision === "AUTO" && row.safeBackfill === "NO")).length}** на ручную проверку, **${rows.filter((row) => ["UNCLASSIFIED", "UNSUPPORTED"].includes(row.proposedDecision)).length}** пока не классифицированы.

## Новые 102 товара

${markdownTable(countBy(rows.filter((row) => row.productId >= 6654 && row.productId <= 6755), (row) => row.proposedDecision), "Решение")}

Из них точное правило HIGH для ограниченного backfill: **${rows.filter((row) => row.productId >= 6654 && row.productId <= 6755 && row.safeBackfill === "YES").length}**. Два задних фонаря получают только общий раздел MEDIUM и требуют проверки перед назначением.

## Изменения от нового правила

${changed.length ? `| ID | Артикул | До | После | Категория | Правило |\n|---:|---|---|---|---|---|\n${changed.map((row) => `| ${row.productId} | ${row.article} | ${row.baselineDecision} | ${row.proposedDecision} | ${row.proposedCategorySlug || "—"} | ${row.proposedRule || "—"} |`).join("\n")}` : "Новых совпадений нет."}

## Контрольные артикулы

| ID | Артикул | Типы | Решение | Категория | Правило/причина |
|---:|---|---|---|---|---|
${controlRows.map((row) => `| ${row.productId} | ${row.article} | ${row.detectedTypes || "—"} | ${row.proposedDecision} | ${row.proposedCategorySlug || "—"} | ${row.proposedDecision === "REVIEW" ? row.proposedReason : row.proposedRule || row.proposedReason} |`).join("\n")}

A2226982201 (ID 6630) и A0009053119 (ID 6567) находятся вне диапазона последних 102 ID; оба включены в общий отчёт и сохранены на ручной проверке.

## Категории AUTO

${markdownTable(countBy(rows.filter((row) => row.proposedDecision === "AUTO"), (row) => row.proposedCategorySlug), "Slug категории", 182)}

## Группы EPC

Товар с несколькими техническими группами учитывается в каждой группе; сумма строк может быть больше 1 146.

| EPC | Всего | AUTO | REVIEW | UNCLASSIFIED | UNSUPPORTED |
|---|---:|---:|---:|---:|---:|
${countBy(rows.flatMap((row) => (row.epcGroups ? row.epcGroups.split(";") : ["(none)"]).map((epc) => ({ epc, decision: row.proposedDecision }))), (row) => row.epc).map(([epc, total]) => {
  const group = rows.flatMap((row) => (row.epcGroups ? row.epcGroups.split(";") : ["(none)"]).map((item) => ({ epc: item, decision: row.proposedDecision }))).filter((row) => row.epc === epc);
  const counts = Object.fromEntries(countBy(group, (row) => row.decision));
  return `| ${epc} | ${total} | ${counts.AUTO || 0} | ${counts.REVIEW || 0} | ${counts.UNCLASSIFIED || 0} | ${counts.UNSUPPORTED || 0} |`;
}).join("\n")}

## Источники решений

${markdownTable(countBy(rows, (row) => row.proposedSource), "Источник")}

\`unclassified.csv\` включает как UNCLASSIFIED, так и UNSUPPORTED; вторые выделены собственным значением в колонке решения.

## Неоднозначные назначения

Флаги указаны для **${flagged.length}** товаров в \`all-products.csv\`; \`review-required.csv\` содержит ${rows.filter((row) => row.proposedDecision === "REVIEW").length} решений REVIEW и ${rows.filter((row) => row.proposedDecision === "AUTO" && row.safeBackfill === "NO").length} автоматических кандидатов (MEDIUM-корень либо OEM-проверка), которые не допускаются к backfill без подтверждения. Особое внимание: REAL_REVIEW, конфликт правил, несколько предлагаемых категорий, MEDIUM-корень и OEM-проверка.

Консервативная проверка семантики дополнительно оставила без автоприменения 9 механических совпадений: 6 накладок бампера (действующее правило \`body-mouldings-trims\`, но ранее проверенные точные аналоги — \`body-bumpers\`), держатель проводки тормозного датчика (не сам датчик), пыльник рулевой тяги (не сама тяга) и общий «Хомут» с одним только EPC 49 (нет явного контекста выхлопа). Эти 9 вошли в REVIEW; автоматический импорт также не назначит их по спорным правилам. Для шести накладок выбор окончательной категории требует проверки утверждённых аналогов/фото, а не догадки.

${markdownTable(countBy(flagged.flatMap((row) => row.ambiguityFlags.split(";").map((flag) => ({ flag }))), (row) => row.flag), "Флаг")}

${flagged.slice(0, 30).map((row) => `- ${row.article} (ID ${row.productId}): ${row.ambiguityFlags}; ${row.proposedCategorySlug || row.possibleCategories || "без категории"}; ${row.proposedReason}`).join("\n")}
`;
await writeFile(path.join(outputDirectory, "summary.md"), summary);
console.log(JSON.stringify({ outputDirectory, products: rows.length, newest: newest.length,
  baseline: Object.fromEntries(countBy(rows, (row) => row.baselineDecision)),
  proposed: Object.fromEntries(countBy(rows, (row) => row.proposedDecision)),
  highBackfill: rows.filter((row) => row.safeBackfill === "YES").length,
  changed: changed.length, flagged: flagged.length }, null, 2));
