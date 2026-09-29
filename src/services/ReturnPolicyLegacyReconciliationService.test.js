import test from "node:test";
import assert from "node:assert/strict";

import {
  projectLegacyReturnPolicy,
  reconcileReturnPolicyToLegacy,
} from "./ReturnPolicyLegacyReconciliationService.js";

const scenarios = [
  ["A", {
    warehouseOverride: "RETURNABLE",
    productOverride: "INHERIT",
    offerOverride: "INHERIT",
  }, { warehouseReturnableByDefault: true, offerIsReturnable: null }],
  ["B", {
    warehouseOverride: "RETURNABLE",
    productOverride: "NON_RETURNABLE",
    offerOverride: "INHERIT",
  }, { warehouseReturnableByDefault: true, offerIsReturnable: false }],
  ["C", {
    warehouseOverride: "NON_RETURNABLE",
    productOverride: "RETURNABLE",
    offerOverride: "INHERIT",
  }, { warehouseReturnableByDefault: false, offerIsReturnable: true }],
  ["D", {
    warehouseOverride: "NON_RETURNABLE",
    productOverride: "NON_RETURNABLE",
    offerOverride: "RETURNABLE",
  }, { warehouseReturnableByDefault: false, offerIsReturnable: true }],
  ["E", {
    warehouseOverride: "RETURNABLE",
    productOverride: "RETURNABLE",
    offerOverride: "NON_RETURNABLE",
  }, { warehouseReturnableByDefault: true, offerIsReturnable: false }],
  ["F", {
    warehouseOverride: "INHERIT",
    productOverride: "INHERIT",
    offerOverride: "INHERIT",
  }, { warehouseReturnableByDefault: true, offerIsReturnable: null }],
];

for (const [name, input, expected] of scenarios) {
  test(`legacy reconciliation scenario ${name}`, () => {
    assert.deepEqual(projectLegacyReturnPolicy(input), expected);
  });
}

function fakePool() {
  const commands = [];
  const client = {
    async query(sql) {
      const text = String(sql).trim();
      commands.push(text);
      if (text.startsWith("SELECT") && text.includes("FROM warehouses")) {
        return { rows: [{ true_count: "3", false_count: "1" }] };
      }
      if (text.startsWith("SELECT") && text.includes("FROM product_offers")) {
        return { rows: [{ null_count: "5", true_count: "2", false_count: "1" }] };
      }
      if (text.startsWith("WITH projected") && text.includes("FROM warehouses")) {
        return { rows: [{
          true_count: "3", false_count: "1",
          change_to_true: "1", change_to_false: "0",
        }] };
      }
      if (text.startsWith("WITH projected") && text.includes("FROM product_offers")) {
        return { rows: [{
          null_count: "4", true_count: "3", false_count: "1",
          change_to_null: "0", change_to_true: "1", change_to_false: "0",
        }] };
      }
      if (text.startsWith("UPDATE warehouses")) return { rowCount: 1 };
      if (text.startsWith("UPDATE product_offers")) return { rowCount: 1 };
      return { rows: [] };
    },
    release() {
      commands.push("RELEASE");
    },
  };
  return { commands, connect: async () => client };
}

test("dry run is read-only, reports projected changes and rolls back", async () => {
  const dbPool = fakePool();
  const summary = await reconcileReturnPolicyToLegacy({ dbPool });
  assert.equal(summary.mode, "DRY_RUN");
  assert.equal(summary.committed, false);
  assert.deepEqual(summary.changes.offers, {
    toNull: 0,
    toTrue: 1,
    toFalse: 0,
  });
  assert.equal(dbPool.commands[0], "BEGIN READ ONLY");
  assert.ok(dbPool.commands.includes("ROLLBACK"));
  assert.equal(dbPool.commands.some((command) => command.startsWith("UPDATE")), false);
  assert.equal(dbPool.commands.at(-1), "RELEASE");
});

test("apply updates only compatibility fields and commits atomically", async () => {
  const dbPool = fakePool();
  const summary = await reconcileReturnPolicyToLegacy({ apply: true, dbPool });
  assert.equal(summary.mode, "APPLY");
  assert.equal(summary.committed, true);
  assert.deepEqual(summary.updated, { warehouses: 1, offers: 1 });
  const updates = dbPool.commands.filter((command) => command.startsWith("UPDATE"));
  assert.equal(updates.length, 2);
  assert.match(updates[0], /^UPDATE warehouses[\s\S]*SET returnable_by_default/);
  assert.doesNotMatch(updates[0], /SET return_policy_override/);
  assert.match(updates[1], /^UPDATE product_offers po[\s\S]*SET is_returnable/);
  assert.doesNotMatch(updates[1], /SET return_policy_override/);
  assert.ok(dbPool.commands.includes("COMMIT"));
  assert.equal(dbPool.commands.at(-1), "RELEASE");
});
