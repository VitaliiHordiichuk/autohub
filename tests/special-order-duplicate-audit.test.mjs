import test from "node:test";
import assert from "node:assert/strict";
import { createSpecialOrderDuplicateAudit } from "../src/services/SpecialOrderDuplicateAudit.js";

function feed(rows) {
  const audit = createSpecialOrderDuplicateAudit({ exampleLimit: 4 });
  for (const [i, [article, group, price, title]] of rows.entries()) {
    audit.consume({ article, group, price, title, lineNumber: i + 1 });
  }
  return audit.finish();
}

test("duplicate audit distinguishes identical rows from price, group and title conflicts", () => {
  const s = feed([
    ["A000000001", "20", "100.0000", "Seat"],
    ["A000000001", "20", "100.0000", "Seat"],
    ["A000000002", "20", "200.0000", "Lamp"],
    ["A000000002", "20", "300.0000", "Lamp"],
    ["A000000003", "20", "400.0000", "Roof"],
    ["A000000003", "18", "400.0000", "Roof"],
    ["A000000004", "20", "500.0000", "Rim"],
    ["A000000004", "20", "500.0000", "Wheel"],
    ["A000000005", "20", "600.0000", "Bolt"],
  ]);
  assert.equal(s.acceptedRows, 9);
  assert.equal(s.uniqueArticles, 5);
  assert.equal(s.articlesWithMultipleRows, 4);
  assert.equal(s.excessRowsBeyondOnePerArticle, 4);
  assert.equal(s.repeatedArticlesWithIdenticalTerms, 1);
  assert.equal(s.articlesWithDifferentPrices, 1);
  assert.equal(s.articlesWithDifferentGroups, 1);
  assert.equal(s.articlesWithDifferentNames, 1);
  assert.equal(s.articlesWithDifferentPriceOrGroup, 2);
  assert.equal(s.pricingConflicts.length, 2);
  assert.equal(s.mostRepeated.length, 4);
});

test("huge repeated article does not allocate a per-row map or example list", () => {
  const audit = createSpecialOrderDuplicateAudit({ exampleLimit: 2 });
  for (let i = 1; i <= 40000; i++) {
    audit.consume({
      article: "A000000001", group: "20",
      price: String(i) + ".0000", title: "", lineNumber: i,
    });
  }
  const s = audit.finish();
  assert.equal(s.uniqueArticles, 1);
  assert.equal(s.excessRowsBeyondOnePerArticle, 39999);
  assert.equal(s.articlesWithDifferentPrices, 1);
  assert.equal(s.pricingConflicts[0].examples.length, 4);
});

test("unsorted input fails loudly rather than producing incorrect duplicate counts", () => {
  const audit = createSpecialOrderDuplicateAudit();
  audit.consume({ article: "Z001", group: "20", price: "1.0000", lineNumber: 1 });
  assert.throws(() => audit.consume({
    article: "A001", group: "20", price: "2.0000", lineNumber: 2,
  }), /not ordered/);
});
