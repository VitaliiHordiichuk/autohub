const ENABLED_VALUES = new Set([
  "true",
  "1",
  "yes",
  "on",
]);

export function isCustomerTaxonomyImportEnabled(
  env = process.env
) {
  const value = String(
    env.CUSTOMER_TAXONOMY_IMPORT_ENABLED ?? ""
  )
    .trim()
    .toLowerCase();

  return ENABLED_VALUES.has(value);
}
