import assert from "node:assert/strict";
import test from "node:test";

import {
  isCustomerTaxonomyImportEnabled,
  isCustomerTaxonomyPublicEnabled,
} from "./featureFlags.js";

test("customer taxonomy import is disabled unless explicitly enabled", () => {
  assert.equal(isCustomerTaxonomyImportEnabled({}), false);
  assert.equal(isCustomerTaxonomyImportEnabled({
    CUSTOMER_TAXONOMY_IMPORT_ENABLED: "",
  }), false);
  assert.equal(isCustomerTaxonomyImportEnabled({
    CUSTOMER_TAXONOMY_IMPORT_ENABLED: "false",
  }), false);
  assert.equal(isCustomerTaxonomyImportEnabled({
    CUSTOMER_TAXONOMY_IMPORT_ENABLED: "0",
  }), false);
  assert.equal(isCustomerTaxonomyImportEnabled({
    CUSTOMER_TAXONOMY_IMPORT_ENABLED: "no",
  }), false);
});

test("customer taxonomy import accepts only explicit enabled values", () => {
  for (const value of ["true", "1", "yes", "on", " TRUE "]) {
    assert.equal(isCustomerTaxonomyImportEnabled({
      CUSTOMER_TAXONOMY_IMPORT_ENABLED: value,
    }), true);
  }

  assert.equal(isCustomerTaxonomyImportEnabled({
    CUSTOMER_TAXONOMY_IMPORT_ENABLED: "enabled",
  }), false);
});

test("customer taxonomy public catalog defaults to legacy EPC", () => {
  for (const value of [undefined, "", "false", "0", "no", "off"]) {
    const env = value === undefined
      ? {}
      : { CUSTOMER_TAXONOMY_PUBLIC_ENABLED: value };
    assert.equal(isCustomerTaxonomyPublicEnabled(env), false);
  }
});

test("customer taxonomy public catalog accepts only explicit enabled values", () => {
  for (const value of ["true", "1", "yes", "on", " TRUE ", " On "]) {
    assert.equal(isCustomerTaxonomyPublicEnabled({
      CUSTOMER_TAXONOMY_PUBLIC_ENABLED: value,
    }), true);
  }

  assert.equal(isCustomerTaxonomyPublicEnabled({
    CUSTOMER_TAXONOMY_PUBLIC_ENABLED: "enabled",
  }), false);
});
