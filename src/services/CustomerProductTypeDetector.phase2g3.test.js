import test from "node:test";
import assert from "node:assert/strict";

import { CUSTOMER_TAXONOMY_PHASE2G3_REVIEW } from "../data/CustomerTaxonomyPhase2G3Review.js";
import {
  CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION,
  detectCustomerProductTypes,
} from "./CustomerProductTypeDetector.js";

const phase2G3TypeCodes = Object.freeze([
  "FASTENER_BOLT",
  "STANDARD_SEAL_GASKET",
  "FASTENER_SCREW",
  "FASTENER_NUT",
  "FASTENER_CLAMP",
  "FASTENER_CLIP_RIVET",
  "STANDARD_PLUG_CAP",
  "FASTENER_WASHER",
  "STANDARD_GROMMET",
  "STANDARD_SEALING_RING",
  "FASTENER_PIN_CIRCLIP",
  "FASTENER_STUD",
]);

function productFor(row) {
  return {
    article: row.article,
    articleNormalized: row.article,
    name: row.name,
    technicalEpcGroups: row.epc ? [row.epc] : [],
  };
}

function reviewedArticle(article) {
  const row = CUSTOMER_TAXONOMY_PHASE2G3_REVIEW.find((item) => item.article === article);
  assert.ok(row, `missing PHASE 2G.3 audit fixture for ${article}`);
  return row;
}

function reviewedType(typeCode) {
  const row = CUSTOMER_TAXONOMY_PHASE2G3_REVIEW.find((item) => (
    item.finalBucket === "HIGH" && item.typeCode === typeCode
  ));
  assert.ok(row, `missing PHASE 2G.3 HIGH fixture for ${typeCode}`);
  return row;
}

test("detector v9 exposes exactly the 12 reviewed Fasteners semantic types", () => {
  assert.equal(CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION, 9);
  for (const typeCode of phase2G3TypeCodes) {
    assert.deepEqual(
      detectCustomerProductTypes(productFor(reviewedType(typeCode))),
      [typeCode],
    );
  }
});

test("all 271 accepted MISSING_RULE products now have exact HIGH bolt evidence", () => {
  const recovered = CUSTOMER_TAXONOMY_PHASE2G3_REVIEW.filter((row) => (
    row.originalBucket === "MISSING_RULE"
  ));
  assert.equal(recovered.length, 271);
  for (const row of recovered) {
    assert.equal(row.finalBucket, "HIGH");
    assert.equal(row.categorySlug, "fasteners-bolts");
    assert.deepEqual(detectCustomerProductTypes(productFor(row)), ["FASTENER_BOLT"]);
  }
});

test("PHASE 2G.3 SAFE and REVIEW decisions never become a narrow fastener type", () => {
  const conservative = CUSTOMER_TAXONOMY_PHASE2G3_REVIEW.filter((row) => (
    row.finalBucket === "SAFE_TOPLEVEL" || row.finalBucket === "REAL_REVIEW"
  ));
  assert.equal(conservative.length, 509);
  for (const row of conservative) {
    const types = detectCustomerProductTypes(productFor(row));
    assert.equal(
      types.some((typeCode) => phase2G3TypeCodes.includes(typeCode)),
      false,
      `${row.article}:${row.epc}`,
    );
  }
});

test("generic names and mixed EPC 98/99 never create unreviewed narrow leaves", () => {
  for (const product of [
    { article: "A9999900001", name: "Кільце", technicalEpcGroups: ["99"] },
    { article: "A9999800002", name: "Кришка", technicalEpcGroups: ["98"] },
    { article: "A9999900003", name: "Хомут", technicalEpcGroups: ["99"] },
    { article: "A9999900004", name: "Кліпса", technicalEpcGroups: ["99"] },
    { article: "A9999800005", name: "Болт", technicalEpcGroups: ["98"] },
    { article: "A9999900006", name: "Болт", technicalEpcGroups: ["99"] },
    { article: "A9990000007", name: "Болт", technicalEpcGroups: [] },
    { article: "N999999999999", name: "Стандартна деталь", technicalEpcGroups: [] },
  ]) {
    const types = detectCustomerProductTypes(product);
    assert.equal(types.some((typeCode) => phase2G3TypeCodes.includes(typeCode)), false);
  }
});

test("functional Engine, Transmission, Exhaust, Wheels and Suspension rows stay outside Fasteners", () => {
  for (const article of [
    "A000016090064",
    "A0002711160",
    "A0004920000",
    "A0004016438",
    "A1403250484",
  ]) {
    const types = detectCustomerProductTypes(productFor(reviewedArticle(article)));
    assert.equal(types.some((typeCode) => phase2G3TypeCodes.includes(typeCode)), false, article);
  }
});

test("dangerous reviewed bolt, ring, cover, clamp and clip rows remain conservative", () => {
  for (const article of [
    "A0004211371",
    "A0005422112",
    "A0005469800",
    "A205890007164",
    "A2106900213",
  ]) {
    const row = reviewedArticle(article);
    assert.equal(row.finalBucket, "REAL_REVIEW");
    const types = detectCustomerProductTypes(productFor(row));
    assert.equal(types.some((typeCode) => phase2G3TypeCodes.includes(typeCode)), false);
  }
});
