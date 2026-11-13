import assert from "node:assert/strict";
import test from "node:test";

import { attemptCustomerTaxonomyImport } from "./CustomerTaxonomyImportAttemptService.js";

test("classification success releases the savepoint and reuses its context", async () => {
  const queries = [];
  const context = { rules: [] };
  const result = await attemptCustomerTaxonomyImport({
    db: { query: async (sql) => { queries.push(sql); } },
    productId: 12,
    context,
    service: {
      createContext: async () => { throw new Error("should not reload rules"); },
      classifyProduct: async ({ productId, context: received }) => {
        assert.equal(productId, 12);
        assert.equal(received, context);
        return { decision: "ASSIGNED_NEW_HIGH" };
      },
    },
  });
  assert.equal(result.taxonomy.decision, "ASSIGNED_NEW_HIGH");
  assert.equal(result.context, context);
  assert.deepEqual(queries, [
    "SAVEPOINT customer_taxonomy_import",
    "RELEASE SAVEPOINT customer_taxonomy_import",
  ]);
});

test("SQL classification failure rolls back only the savepoint and reports the product", async () => {
  const queries = [];
  const logged = [];
  const result = await attemptCustomerTaxonomyImport({
    db: { query: async (sql) => { queries.push(sql); } },
    productId: 13,
    service: {
      createContext: async () => ({ rules: [] }),
      classifyProduct: async () => {
        const error = new Error("inactive taxonomy target");
        error.code = "23514";
        throw error;
      },
    },
    logger: { error: (...args) => logged.push(args) },
  });
  assert.equal(result.taxonomy, null);
  assert.equal(result.error.code, "23514");
  assert.deepEqual(result.context, { rules: [] });
  assert.deepEqual(queries, [
    "SAVEPOINT customer_taxonomy_import",
    "ROLLBACK TO SAVEPOINT customer_taxonomy_import",
    "RELEASE SAVEPOINT customer_taxonomy_import",
  ]);
  assert.equal(logged[0][1].productId, 13);
});

test("rule-loading failure leaves no context so the batch can stop retrying it", async () => {
  const result = await attemptCustomerTaxonomyImport({
    db: { query: async () => ({}) },
    productId: 14,
    service: {
      createContext: async () => { throw new Error("rules unavailable"); },
      classifyProduct: async () => { throw new Error("should not classify"); },
    },
    logger: { error: () => {} },
  });
  assert.equal(result.context, null);
  assert.match(result.error.message, /rules unavailable/);
});
