export const RETURN_POLICY = Object.freeze({
  INHERIT: "INHERIT",
  RETURNABLE: "RETURNABLE",
  NON_RETURNABLE: "NON_RETURNABLE",
});

export const RETURN_POLICY_SOURCE = Object.freeze({
  OFFER: "OFFER",
  PRODUCT: "PRODUCT",
  WAREHOUSE: "WAREHOUSE",
  ORGANIZATION: "ORGANIZATION",
});

const OVERRIDES = new Set(Object.values(RETURN_POLICY));

export function normalizeReturnPolicyOverride(value, label = "returnPolicyOverride") {
  const normalized = String(value || "").trim().toUpperCase();
  if (!OVERRIDES.has(normalized)) {
    const error = new Error(
      `${label} должно быть INHERIT, RETURNABLE или NON_RETURNABLE`
    );
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export function normalizeReturnPolicyNote(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  return String(value).trim().slice(0, 2000);
}

function explicitPolicy(value) {
  const normalized = String(value || RETURN_POLICY.INHERIT).toUpperCase();
  return normalized === RETURN_POLICY.RETURNABLE
    || normalized === RETURN_POLICY.NON_RETURNABLE
    ? normalized
    : null;
}

export const ReturnPolicyService = {
  resolve({
    offerOverride = RETURN_POLICY.INHERIT,
    productOverride = RETURN_POLICY.INHERIT,
    warehouseOverride = RETURN_POLICY.INHERIT,
  } = {}) {
    const offer = explicitPolicy(offerOverride);
    if (offer) return { policy: offer, source: RETURN_POLICY_SOURCE.OFFER };

    const product = explicitPolicy(productOverride);
    if (product) return { policy: product, source: RETURN_POLICY_SOURCE.PRODUCT };

    const warehouse = explicitPolicy(warehouseOverride);
    if (warehouse) return { policy: warehouse, source: RETURN_POLICY_SOURCE.WAREHOUSE };

    return {
      policy: RETURN_POLICY.RETURNABLE,
      source: RETURN_POLICY_SOURCE.ORGANIZATION,
    };
  },

  resolveRow(row = {}) {
    return this.resolve({
      offerOverride: row.offer_return_policy_override
        ?? row.return_policy_override
        ?? RETURN_POLICY.INHERIT,
      productOverride: row.product_return_policy_override
        ?? RETURN_POLICY.INHERIT,
      warehouseOverride: row.warehouse_return_policy_override
        ?? RETURN_POLICY.INHERIT,
    });
  },

  isReturnable(result) {
    return result?.policy !== RETURN_POLICY.NON_RETURNABLE;
  },
};
