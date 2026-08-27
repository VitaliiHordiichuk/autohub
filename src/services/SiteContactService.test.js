import test from "node:test";
import assert from "node:assert/strict";

import {
  formatUkrainianPhone,
  normalizeUkrainianPhone,
  SiteContactService,
} from "./SiteContactService.js";

test("український номер нормалізується до E.164", () => {
  assert.equal(normalizeUkrainianPhone("+380 67 123 45 67"), "+380671234567");
  assert.equal(normalizeUkrainianPhone("+380(67)123-45-67"), "+380671234567");
  assert.equal(formatUkrainianPhone("+380671234567"), "+380 67 123 45 67");
});

test("порожнє значення прибирає публічний номер", () => {
  assert.equal(normalizeUkrainianPhone("   "), null);
  assert.equal(formatUkrainianPhone(null), null);
});

test("номер іншого формату відхиляється", () => {
  assert.throws(() => normalizeUkrainianPhone("0671234567"), /\+380/);
  assert.throws(() => normalizeUkrainianPhone("+48123123123"), /\+380/);
  assert.throws(() => normalizeUkrainianPhone("+380 67 123 45"), /\+380/);
});

test("оновлення зберігає нормалізований номер", async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [{
          phone_e164: values[0],
          updated_by: values[1],
          updated_at: "2026-08-27T12:00:00.000Z",
        }],
      };
    },
  };

  const contact = await SiteContactService.update({
    phone: "+380 67 123 45 67",
    changedBy: 17,
  }, db);

  assert.deepEqual(calls[0].values, ["+380671234567", 17]);
  assert.equal(contact.displayPhone, "+380 67 123 45 67");
});
