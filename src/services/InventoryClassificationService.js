export const FULFILLMENT_TYPE = Object.freeze({
  STOCK: "STOCK",
  SUPPLIER_ORDER: "SUPPLIER_ORDER",
});

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Resolve one canonical fulfillment type for every public and checkout path.
 * Supplier metadata is authoritative when present; warehouse metadata is the
 * next-best source. The duplicated offer source_type is retained as a legacy
 * fallback while existing data is audited and repaired safely.
 */
export function resolveFulfillmentType(offer = {}) {
  const supplierType = normalized(offer.supplier_type);
  const warehouseType = normalized(offer.warehouse_type ?? offer.type);
  const sourceType = normalized(offer.source_type ?? offer.sourceType);

  if (supplierType === "OWN") return FULFILLMENT_TYPE.STOCK;
  if (supplierType === "PARTNER") return FULFILLMENT_TYPE.SUPPLIER_ORDER;

  if (warehouseType === "OWN") return FULFILLMENT_TYPE.STOCK;
  if (warehouseType === "SUPPLIER") return FULFILLMENT_TYPE.SUPPLIER_ORDER;

  return sourceType === "SUPPLIER" || sourceType === "SUPPLIER_ORDER"
    ? FULFILLMENT_TYPE.SUPPLIER_ORDER
    : FULFILLMENT_TYPE.STOCK;
}

export function sourceTypeForFulfillment(fulfillmentType) {
  return fulfillmentType === FULFILLMENT_TYPE.SUPPLIER_ORDER
    ? "SUPPLIER"
    : "OWN_STOCK";
}

export function canonicalOfferClassification(offer = {}) {
  const fulfillmentType = resolveFulfillmentType(offer);
  return {
    fulfillmentType,
    sourceType: sourceTypeForFulfillment(fulfillmentType),
  };
}
