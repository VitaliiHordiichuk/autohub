import test from "node:test";
import assert from "node:assert/strict";

import { AdminProductService } from "./AdminProductService.js";
import { AdminWarehouseOfferRepository } from "../repositories/AdminWarehouseOfferRepository.js";
import { WarehouseRepository } from "../repositories/WarehouseRepository.js";

test("admin offer round-trip writes a tri-state override and internal note", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 9, return_policy_override: params[1], return_policy_note: params[2] }] };
    },
  };
  const row = await AdminWarehouseOfferRepository.setReturnPolicy({
    offerId: 9,
    returnPolicyOverride: "NON_RETURNABLE",
    returnPolicyNote: "Спецзаказ",
  }, db);
  assert.equal(row.return_policy_override, "NON_RETURNABLE");
  assert.equal(row.return_policy_note, "Спецзаказ");
  assert.match(calls[0].sql, /return_policy_override = \$2/);
  assert.match(calls[0].sql, /is_returnable = CASE/);
});

test("admin warehouse round-trip writes override and note with rollback-safe legacy sync", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 4, return_policy_override: params[16], return_policy_note: params[18] }] };
    },
  };
  const row = await WarehouseRepository.update(4, {
    returnPolicyOverride: "RETURNABLE",
    returnPolicyNote: "Manager decision",
  }, db);
  assert.equal(row.return_policy_override, "RETURNABLE");
  assert.equal(row.return_policy_note, "Manager decision");
  assert.match(calls[0].sql, /returnable_by_default = CASE/);
});

test("admin product round-trip returns the backend effective preview", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/UPDATE products/.test(sql)) return { rows: [{ id: 11 }] };
      return { rows: [{
        id: 11,
        product_return_policy_override: "NON_RETURNABLE",
        product_return_policy_note: "Электрика после установки",
        offer_return_policy_override: "INHERIT",
        warehouse_return_policy_override: "RETURNABLE",
      }] };
    },
  };
  const result = await AdminProductService.setReturnPolicy(11, {
    offerId: 22,
    returnPolicyOverride: "NON_RETURNABLE",
    returnPolicyNote: "Электрика после установки",
  }, db);
  assert.deepEqual(result.effectiveReturnPolicy, {
    policy: "NON_RETURNABLE",
    source: "PRODUCT",
  });
  assert.equal(result.returnPolicyNote, "Электрика после установки");
  assert.equal(calls.length, 2);
});
