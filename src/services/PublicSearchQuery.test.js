import test from "node:test";
import assert from "node:assert/strict";
import { cleanPublicSearchQuery, escapeSearchLike, publicSearchTerms } from "./PublicSearchQuery.js";

test("text query accepts names, normalizes whitespace and rejects invalid values", () => {
  assert.equal(cleanPublicSearchQuery("  колодки   гальмівні "), "колодки гальмівні");
  for (const value of [null, undefined, [], {}, "a", "null", "UNDEFINED", "a".repeat(256)]) assert.equal(cleanPublicSearchQuery(value), "");
});
test("synonyms are shared across suggestions and search, SQL wildcards stay literal", () => {
  const terms = publicSearchTerms("колодки гальмівні");
  assert.equal(terms.length, 2);
  assert.ok(terms[0].includes("%колодка%"));
  assert.ok(terms[0].includes("%pads%"));
  assert.ok(terms[1].includes("%тормозные%"));
  assert.equal(escapeSearchLike("100%_\\"), "100\\%\\_\\\\");
  assert.deepEqual(publicSearchTerms("foo%"), [["%foo\\%%"]]);
  assert.deepEqual(publicSearchTerms(Array.from({ length: 13 }, (_, i) => `word${i}`).join(" ")), []);
});
