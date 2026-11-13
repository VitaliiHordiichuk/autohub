import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CustomerTaxonomyImportService } from "../src/services/CustomerTaxonomyImportService.js";
import { CustomerTaxonomyAssignmentService } from "../src/services/CustomerTaxonomyAssignmentService.js";
import { requiresOemVerificationBeforeBackfill } from "../src/services/CustomerTaxonomyUncategorizedBackfillService.js";

const [sourcePath, outputDirectory, cleanWorktree] = process.argv.slice(2);
if (!sourcePath || !outputDirectory || !cleanWorktree) {
  throw new Error("Usage: node scripts/preview-customer-taxonomy-full-export.mjs <full-export.csv> <output-dir> <clean-worktree>");
}
const oldServicePath = path.join(cleanWorktree, "src/services/CustomerTaxonomyImportService.js");
const { CustomerTaxonomyImportService: oldService } = await import(pathToFileURL(oldServicePath).href);

function parseExport(text) {
  const lines = text.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
  if (lines.shift() !== "record_type,data") throw new Error("Unexpected export header");
  const records = { product: [], rule: [], category: [] };
  for (const [index, line] of lines.entries()) {
    const split = line.indexOf(",");
    const type = line.slice(0, split);
    const payload = line.slice(split + 1);
    if (!Object.hasOwn(records, type) || split < 0 || !payload.startsWith('"') || !payload.endsWith('"')) {
      throw new Error(`Malformed export line ${index + 2}`);
    }
    records[type].push(JSON.parse(payload.slice(1, -1).replaceAll('""', '"')));
  }
  const sizes = Object.fromEntries(Object.entries(records).map(([key, values]) => [key, values.length]));
  if (sizes.product !== 6621 || sizes.rule !== 374 || sizes.category !== 182) {
    throw new Error(`Unexpected export counts: ${JSON.stringify(sizes)}`);
  }
  return records;
}

function uniqueMap(rows, key, label) {
  const map = new Map(rows.map((row) => [key(row), row]));
  if (map.size !== rows.length) throw new Error(`Duplicate ${label}`);
  return map;
}

function restoreProduct(row) {
  const article = String(row.articleNormalized || row.article || "");
  const epc = new Set();
  if (/^A[0-9]{10}/.test(article)) epc.add(article.slice(4, 6));
  for (const category of row.technicalCategories || []) {
    const match = String(category.slug || "").match(/^mb-group-(\d{2})$/i);
    if (match) epc.add(match[1]);
  }
  return {
    id: Number(row.id), article: row.article, articleNormalized: row.articleNormalized,
    name: row.name, brandId: row.brandId === null ? null : Number(row.brandId),
    brandName: row.brandName || null, isActive: row.isActive,
    translations: row.translations || [], technicalCategories: row.technicalCategories || [],
    technicalEpcGroups: [...epc].sort(), memberships: row.memberships || [],
  };
}

function restoreRule(row, categories) {
  const target = categories.get(Number(row.target_category_id));
  if (!target || target.slug !== row.targetCategorySlug) throw new Error(`Invalid target for rule ${row.code}`);
  const parent = target.parentId === null ? null : categories.get(target.parentId);
  if ((parent?.slug || null) !== (row.targetParentSlug || null)) {
    throw new Error(`Invalid parent for rule ${row.code}`);
  }
  return {
    id: Number(row.id), code: row.code, version: Number(row.version),
    detectorVersion: Number(row.detector_version), sourceKind: row.source_kind,
    assignmentRole: row.assignment_role, numberFamily: row.number_family,
    epcGroup: row.epc_group, matchType: row.match_type, matchValue: row.match_value,
    excludeValues: row.exclude_values || [], targetCategoryId: target.id,
    targetCategorySlug: target.slug, targetParentId: target.parentId,
    targetParentSlug: parent?.slug || null, targetStatus: target.status,
    targetIsActive: target.isActive, priority: Number(row.priority),
    confidence: row.confidence, autoApprovalAllowed: row.auto_approval_allowed === true,
    isActive: row.is_active === true,
  };
}

function proposedRule(sql, categories, rules) {
  const slug = sql.match(/WHERE slug = '([^']+)' AND status = 'ACTIVE'/)?.[1];
  const values = sql.match(/SELECT\s+'([^']+)',\s*(\d+),\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'\{\}'::TEXT\[\],\s*target\.id,\s*(\d+),\s*'([^']+)',\s*(TRUE|FALSE),\s*(TRUE|FALSE)\s*FROM target/s);
  const target = [...categories.values()].find((row) => row.slug === slug);
  const parent = categories.get(target?.parentId);
  if (!slug || !values || !sql.includes("118_add_explicit_engine_air_filter_epc47_rule")
    || !target || !parent || target.status !== "ACTIVE" || !target.isActive
    || rules.some((rule) => rule.code === values[1])) {
    throw new Error("Migration 118 differs from the reviewed one-rule simulation");
  }
  return {
    id: Math.max(...rules.map((rule) => rule.id)) + 1,
    code: values[1], version: Number(values[2]), detectorVersion: Number(values[3]),
    sourceKind: values[4], assignmentRole: values[5], numberFamily: values[6],
    epcGroup: values[7], matchType: values[8], matchValue: values[9], excludeValues: [],
    targetCategoryId: target.id, targetCategorySlug: target.slug,
    targetParentId: target.parentId, targetParentSlug: parent.slug,
    targetStatus: target.status, targetIsActive: target.isActive,
    priority: Number(values[10]), confidence: values[11],
    autoApprovalAllowed: values[12] === "TRUE", isActive: values[13] === "TRUE",
  };
}

function restoreMemberships(product, categories, activeRules) {
  return product.memberships.map((row) => {
    const categoryId = Number(row.customerCategoryId);
    const category = categories.get(categoryId);
    if (!category || category.slug !== row.categorySlug) {
      throw new Error(`Product ${product.id}: membership category mismatch`);
    }
    const ruleCode = row.ruleCode || null;
    const ruleVersion = row.ruleVersion === null ? null : Number(row.ruleVersion);
    const activeRule = activeRules.get(`${ruleCode}:${ruleVersion}`);
    return {
      productId: product.id, customerCategoryId: categoryId,
      categorySlug: category.slug, parentSlug: categories.get(category.parentId)?.slug || null,
      isPrimary: row.isPrimary === true, assignmentSource: row.assignmentSource,
      assignmentOrigin: row.assignmentOrigin, ruleCode, ruleVersion,
      confidence: row.confidence, approvalStatus: row.approvalStatus,
      categoryStatus: category.status, categoryIsActive: category.isActive,
      // Only active rules are exported. Missing historical rules cannot be inferred.
      ...(activeRule ? { historicalRuleExists: true,
        historicalRuleTargetCategoryId: activeRule.targetCategoryId } : {}),
    };
  });
}

function decision(evaluation) {
  const { candidate, resolution, disposition } = evaluation;
  const proposals = resolution.proposals || [];
  const possible = [...new Set(proposals.map((proposal) => proposal.category.slug))];
  const review = disposition.requiresReview || (resolution.conflicts || []).length > 0
    || proposals.some((proposal) => proposal.approvalStatus === "REVIEW");
  const status = candidate ? "AUTO" : review ? "REVIEW"
    : resolution.numberFamily === "OTHER" ? "UNSUPPORTED" : "UNCLASSIFIED";
  const proposal = candidate || (possible.length === 1 ? proposals[0] : null);
  const reason = disposition.reason || (resolution.conflicts || []).map((item) => item.reason).join(";")
    || (status === "AUTO" ? "MATCHED_APPROVED_RULE" : status === "REVIEW"
      ? "REVIEW_PROPOSAL" : status === "UNSUPPORTED" ? "UNSUPPORTED_ARTICLE_FAMILY"
        : "NO_MATCHING_APPROVED_RULE");
  const oemHold = requiresOemVerificationBeforeBackfill(evaluation.product.article);
  return {
    status, category: proposal?.category.slug || "", rule: proposal?.ruleCode || "",
    confidence: proposal?.confidence || "", source: candidate?.assignmentSource || (review ? "REVIEW" : "NONE"),
    detectedTypes: resolution.typeCodes || [], possibleCategories: possible,
    reason, oemHold,
    safeBackfill: status === "AUTO" && candidate.assignmentSource === "RULE"
      && candidate.confidence === "HIGH" && candidate.approvalStatus === "AUTO_APPROVED" && !oemHold,
  };
}

function cell(value) {
  const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(rows, columns) {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((key) => cell(row[key])).join(",")).join("\n")}\n`;
}
function tally(rows, key) {
  return Object.fromEntries([...new Set(rows.map((row) => row[key]))]
    .map((value) => [value, rows.filter((row) => row[key] === value).length]).sort());
}

const sourceText = await readFile(sourcePath, "utf8");
const exported = parseExport(sourceText);
const categories = uniqueMap(exported.category.map((row) => ({
  id: Number(row.id), slug: row.slug,
  parentId: row.parent_id === null ? null : Number(row.parent_id),
  status: row.status, isActive: row.is_active === true,
})), (row) => row.id, "category ID");
uniqueMap([...categories.values()], (row) => row.slug, "category slug");
const products = exported.product.map(restoreProduct).sort((left, right) => left.id - right.id);
uniqueMap(products, (row) => row.id, "product ID");
const rules = exported.rule.map((row) => restoreRule(row, categories));
const activeRules = uniqueMap(rules, (row) => `${row.code}:${row.version}`, "active rule version");
const migration = await readFile(new URL("../migrations/118_add_explicit_engine_air_filter_epc47_rule.sql", import.meta.url), "utf8");
const nextRule = proposedRule(migration, categories, rules);
const categoryBySlug = uniqueMap([...categories.values()], (row) => row.slug, "category slug");
const contexts = [rules, [...rules, nextRule]].map((set) => ({ rules: set, categoryBySlug }));
const repository = { listCategoriesBySlugs: async () => { throw new Error("Category missing in export"); } };
const evaluate = (service, product, memberships, context, assignmentOrigin) => service.evaluateProduct(
  { product, existingMemberships: memberships, context },
  { db: {}, repository, assignmentOrigin },
);

const existingRows = [];
const uncategorizedRows = [];
const conflictRows = [];
let missingHistoricalRuleValidation = 0;
for (const product of products) {
  const memberships = restoreMemberships(product, categories, activeRules);
  const primaries = memberships.filter((entry) => entry.isPrimary);
  const approvedPrimary = primaries.find((entry) => ["AUTO_APPROVED", "MANUAL_APPROVED"].includes(entry.approvalStatus));
  const assignmentOrigin = approvedPrimary ? "IMPORT" : "BACKFILL";
  const oldEvaluation = await evaluate(oldService, product, memberships, contexts[0], assignmentOrigin);
  const currentEvaluation = await evaluate(CustomerTaxonomyImportService, product, memberships, contexts[0], assignmentOrigin);
  const proposedEvaluation = await evaluate(CustomerTaxonomyImportService, product, memberships, contexts[1], assignmentOrigin);
  const translations = Object.fromEntries(product.translations.map((row) => [row.languageCode, row.name]));
  const shared = {
    productId: product.id, article: product.article, name: product.name,
    nameUk: translations.uk || "", nameRu: translations.ru || "", nameEn: translations.en || "",
    epcGroups: product.technicalEpcGroups.join(";"), membershipCount: memberships.length,
    primaryCount: primaries.length,
  };
  if (approvedPrimary) {
    const oldTypes = oldEvaluation.resolution.typeCodes || [];
    const currentTypes = currentEvaluation.resolution.typeCodes || [];
    const addedTypes = currentTypes.filter((type) => !oldTypes.includes(type));
    const removedTypes = oldTypes.filter((type) => !currentTypes.includes(type));
    const activeRuleUnknown = approvedPrimary.assignmentSource === "RULE"
      && !activeRules.has(`${approvedPrimary.ruleCode}:${approvedPrimary.ruleVersion}`);
    if (activeRuleUnknown) missingHistoricalRuleValidation += 1;
    const simulationRepository = {
      lockProductForAssignment: async () => {},
      listMembershipsForProduct: async () => memberships,
      demoteAutomaticPrimary: async () => { throw new Error(`Unexpected primary demotion: ${product.id}`); },
      upsertMembership: async () => { throw new Error(`Unexpected membership write: ${product.id}`); },
    };
    const applied = await CustomerTaxonomyAssignmentService.applyResolutionInTransaction({
      productId: product.id,
      resolution: { ...currentEvaluation.resolution, proposals: currentEvaluation.proposals },
      assignmentOrigin: "IMPORT",
    }, { db: {}, repository: simulationRepository });
    const preserved = ["PRESERVE_MANUAL", "PRESERVE_EXISTING_APPROVED_PRIMARY"].includes(applied.decision)
      && applied.preservedApprovedPrimary?.customerCategoryId === approvedPrimary.customerCategoryId
      && applied.applied.length === 0;
    const currentCandidate = currentEvaluation.candidate?.category.slug || "";
    const oldCandidate = oldEvaluation.candidate?.category.slug || "";
    const proposedCandidate = proposedEvaluation.candidate?.category.slug || "";
    const flags = [];
    if (!preserved) flags.push("PRIMARY_NOT_PRESERVED");
    if (addedTypes.length) flags.push("NEW_DETECTOR_MATCH");
    if (removedTypes.length) flags.push("REMOVED_DETECTOR_MATCH");
    if (currentCandidate && currentCandidate !== approvedPrimary.categorySlug) {
      flags.push(oldCandidate === currentCandidate ? "EXISTING_CANDIDATE_DIFFERS" : "NEW_CANDIDATE_DIFFERS");
    }
    if (proposedCandidate && proposedCandidate !== currentCandidate) flags.push("MIGRATION_118_CANDIDATE_CHANGE");
    if (currentEvaluation.resolution.existingPrimaryDecision.issues.length) flags.push("PRIMARY_INTEGRITY_ISSUE");
    const row = {
      ...shared, existingPrimaryCategory: approvedPrimary.categorySlug,
      existingPrimaryId: approvedPrimary.customerCategoryId,
      existingPrimarySource: approvedPrimary.assignmentSource,
      existingPrimaryApproval: approvedPrimary.approvalStatus,
      oldDetectedTypes: oldTypes.join(";"), currentDetectedTypes: currentTypes.join(";"),
      addedTypes: addedTypes.join(";"), removedTypes: removedTypes.join(";"),
      oldCandidate, currentCandidate, proposedCandidate,
      simulatedAssignmentDecision: applied.decision, preserved: preserved ? "YES" : "NO",
      historicalRuleInActiveExport: approvedPrimary.assignmentSource === "RULE"
        ? (activeRuleUnknown ? "NO" : "YES") : "NOT_APPLICABLE",
      conflictFlags: flags.join(";"),
    };
    existingRows.push(row);
    if (flags.length) conflictRows.push({ productId: row.productId, article: row.article,
      group: "EXISTING", flags: row.conflictFlags, existingCategory: row.existingPrimaryCategory,
      proposedCategory: row.currentCandidate || row.proposedCandidate, detail: row.addedTypes || row.removedTypes });
  } else {
    const base = decision(currentEvaluation);
    const proposed = decision(proposedEvaluation);
    const oldTypes = oldEvaluation.resolution.typeCodes || [];
    const newTypes = currentEvaluation.resolution.typeCodes || [];
    const flags = [];
    if (proposed.oemHold) flags.push("OEM_VERIFICATION_REQUIRED");
    if (proposed.reason.includes("REAL_REVIEW")) flags.push("HISTORICAL_REAL_REVIEW");
    if (proposed.possibleCategories.length > 1) flags.push("MULTIPLE_PROPOSALS");
    if (proposed.status === "AUTO" && !proposed.safeBackfill) flags.push("AUTO_NOT_BACKFILL_ELIGIBLE");
    if (primaries.length) flags.push("UNAPPROVED_EXISTING_PRIMARY");
    const row = {
      ...shared, oldDetectedTypes: oldTypes.join(";"), detectedTypes: newTypes.join(";"),
      addedTypes: newTypes.filter((type) => !oldTypes.includes(type)).join(";"),
      activeDecision: base.status, activeCategory: base.category, activeRule: base.rule,
      activeConfidence: base.confidence, activeSource: base.source, activeReason: base.reason,
      migration118Decision: proposed.status, migration118Category: proposed.category,
      migration118Rule: proposed.rule, migration118Confidence: proposed.confidence,
      migration118Source: proposed.source, migration118Reason: proposed.reason,
      possibleCategories: proposed.possibleCategories.join(";"),
      safeBackfill: proposed.safeBackfill ? "YES" : "NO",
      conflictFlags: flags.join(";"),
    };
    uncategorizedRows.push(row);
    if (flags.length && !flags.every((flag) => flag === "HISTORICAL_REAL_REVIEW")) {
      conflictRows.push({ productId: row.productId, article: row.article, group: "UNCATEGORIZED",
        flags: row.conflictFlags, existingCategory: "", proposedCategory: row.migration118Category,
        detail: row.migration118Reason });
    }
  }
}

if (existingRows.length !== 5475 || uncategorizedRows.length !== 1146
  || existingRows.some((row) => row.primaryCount !== 1)
  || uncategorizedRows.some((row) => row.primaryCount !== 0)) {
  throw new Error(`Unexpected membership partition: ${existingRows.length}/${uncategorizedRows.length}`);
}
const newest = products.filter((product) => product.id >= 6654 && product.id <= 6755);
if (newest.length !== 102 || newest.some((product, index) => product.id !== 6654 + index)) {
  throw new Error("Incomplete newest 102 cohort");
}
const newestRows = uncategorizedRows.filter((row) => row.productId >= 6654 && row.productId <= 6755);
if (newestRows.length !== 102) throw new Error("Newest cohort is not entirely uncategorized");
for (const article of ["A2976709601", "A2946700400", "A2966701300"]) {
  const row = uncategorizedRows.find((item) => item.article === article);
  if (!row || row.migration118Category !== "body-windshields" || row.migration118Decision !== "AUTO") {
    throw new Error(`Windshield control failed: ${article}`);
  }
}
for (const article of ["A2226982201", "A0009053119"]) {
  const row = uncategorizedRows.find((item) => item.article === article);
  if (!row || row.migration118Decision === "AUTO" || !row.migration118Reason.includes("REAL_REVIEW")) {
    throw new Error(`REAL_REVIEW control failed: ${article}`);
  }
}
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "existing-products.csv"), toCsv(existingRows, Object.keys(existingRows[0]))),
  writeFile(path.join(outputDirectory, "uncategorized-products.csv"), toCsv(uncategorizedRows, Object.keys(uncategorizedRows[0]))),
  writeFile(path.join(outputDirectory, "conflicts.csv"), toCsv(conflictRows, ["productId", "article", "group", "flags", "existingCategory", "proposedCategory", "detail"])),
  writeFile(path.join(outputDirectory, "newest-102.csv"), toCsv(newestRows, Object.keys(newestRows[0]))),
]);
const summary = {
  sourceSha256: createHash("sha256").update(sourceText).digest("hex"),
  sourceCounts: { products: products.length, rules: rules.length, categories: categories.size,
    memberships: products.reduce((count, product) => count + product.memberships.length, 0) },
  existing: { count: existingRows.length, preserved: existingRows.filter((row) => row.preserved === "YES").length,
    manual: existingRows.filter((row) => row.existingPrimarySource === "MANUAL").length,
    detectorChanged: existingRows.filter((row) => row.addedTypes || row.removedTypes).length,
    addedDetectorTypes: existingRows.filter((row) => row.addedTypes).length,
    candidateMismatch: existingRows.filter((row) => row.conflictFlags.includes("CANDIDATE_DIFFERS")).length,
    historicalRuleUnverified: missingHistoricalRuleValidation,
    flagCounts: tally(conflictRows.filter((row) => row.group === "EXISTING"), "flags") },
  uncategorized: { count: uncategorizedRows.length,
    activeDecisions: tally(uncategorizedRows, "activeDecision"),
    migration118Decisions: tally(uncategorizedRows, "migration118Decision"),
    safeBackfill: uncategorizedRows.filter((row) => row.safeBackfill === "YES").length,
    realReview: uncategorizedRows.filter((row) => row.migration118Reason.includes("REAL_REVIEW")).length,
    migration118Changes: uncategorizedRows.filter((row) => row.activeDecision !== row.migration118Decision
      || row.activeCategory !== row.migration118Category || row.activeRule !== row.migration118Rule).length },
  newest: { count: newestRows.length, decisions: tally(newestRows, "migration118Decision") },
  conflicts: conflictRows.length,
};
console.log(JSON.stringify(summary, null, 2));
await writeFile(path.join(outputDirectory, "analysis.json"), `${JSON.stringify(summary, null, 2)}\n`);
