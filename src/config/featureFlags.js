const ENABLED_VALUES = new Set([
  "true",
  "1",
  "yes",
  "on",
]);

export function isCustomerTaxonomyImportEnabled(
  env = process.env
) {
  return isExplicitlyEnabled(
    env.CUSTOMER_TAXONOMY_IMPORT_ENABLED
  );
}

export function isCustomerTaxonomyPublicEnabled(
  env = process.env
) {
  return isExplicitlyEnabled(
    env.CUSTOMER_TAXONOMY_PUBLIC_ENABLED
  );
}

export function isCommitOnSubmitCheckoutEnabled(
  env = process.env
) {
  return isExplicitlyEnabled(
    env.CHECKOUT_COMMIT_ON_SUBMIT_ENABLED
  );
}

function isExplicitlyEnabled(value) {
  return ENABLED_VALUES.has(
    String(value ?? "")
      .trim()
      .toLowerCase()
  );
}
