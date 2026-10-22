import test from "node:test";
import assert from "node:assert/strict";

import { WarehouseService } from "./WarehouseService.js";
import { WarehouseRepository } from "../repositories/WarehouseRepository.js";
import { SupplierRepository } from "../repositories/SupplierRepository.js";

test("city-only warehouse PATCH leaves all other settings untouched", async () => {
  const originalFindById = WarehouseRepository.findById;
  const originalUpdate = WarehouseRepository.update;
  const originalSupplierFindById = SupplierRepository.findById;
  const current = {
    id: 7,
    name: "Internal warehouse",
    city: "Харків",
    type: "SUPPLIER",
    supplier_id: 9,
    priority: 3,
    quantity: 1,
    return_policy_override: "INHERIT",
  };
  let updateArguments;
  WarehouseRepository.findById = async () => current;
  WarehouseRepository.update = async (warehouseId, changes) => {
    updateArguments = { warehouseId, changes };
    return { ...current, ...changes };
  };
  SupplierRepository.findById = async () => {
    throw new Error("city-only PATCH must not look up or reclassify the supplier");
  };

  try {
    const updated = await WarehouseService.updateWarehouse(7, { city: " Дніпро " });
    assert.deepEqual(updateArguments, { warehouseId: 7, changes: { city: "Дніпро" } });
    assert.equal(updated.city, "Дніпро");
    for (const key of ["name", "type", "supplier_id", "priority", "quantity"]) {
      assert.equal(updated[key], current[key]);
    }
    await WarehouseService.updateWarehouse(7, { city: null });
    assert.deepEqual(updateArguments, { warehouseId: 7, changes: { city: null } });
  } finally {
    WarehouseRepository.findById = originalFindById;
    WarehouseRepository.update = originalUpdate;
    SupplierRepository.findById = originalSupplierFindById;
  }
});

test("city-only repository update sets only city and updated timestamp", async () => {
  let parameters;
  const db = {
    query: async (_sql, values) => {
      parameters = values;
      return { rows: [{ id: 7, city: "Дніпро" }] };
    },
  };
  await WarehouseRepository.update(7, { city: "Дніпро" }, db);
  assert.equal(parameters[0], 7);
  assert.equal(parameters[2], false); // supplier_id unchanged
  assert.equal(parameters[5], true);
  assert.equal(parameters[6], "Дніпро");
  assert.equal(parameters[11], false); // priority unchanged
  assert.equal(parameters[17], false); // return-policy note unchanged
  for (const index of [1, 4, 7, 8, 9, 10, 13, 14, 15, 16]) {
    assert.equal(parameters[index], undefined);
  }
});
