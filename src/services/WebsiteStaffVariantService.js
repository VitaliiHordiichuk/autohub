import { ProductRepository } from "../repositories/ProductRepository.js";

// Staff-only inventory view: uses the SAME product family resolved by website
// SearchService, but does NOT use public offer selection/pricing. Public offer
// rules can suppress a real stocked warehouse in favour of a retail-priced
// supplier. That is correct for shoppers, not for staff stock visibility.
//
// This result is attached only to the authenticated staff bridge response.
// Never return raw repository rows (they include purchase_price and other
// internal fields); only expose the offer ID and available quantity here.
export async function websiteStaffVariants(read, deps = {}) {
  if (!read?.found) return [];
  const exact = read.searchResult?.exactProduct;
  const all = [exact, ...(read.searchResult?.family || [])];
  const seen = new Set();
  const products = all.filter(product => {
    const id = Number(product?.id);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (!products.length) return [];

  const findOffers = deps.findOffers || ProductRepository.findOffersByProductIds;
  // Same reservation deductions and source-active checks as website offers.
  // Null user/cart means stock available to a new customer, not reserved
  // inventory for one particular session.
  const rows = await findOffers(
    products.map(product => Number(product.id)),
    { userId: null, cartId: null }
  );

  const offersByProduct = new Map(
    products.map(product => [Number(product.id), []])
  );

  for (const offer of rows) {
    const productId = Number(offer.product_id);
    const id = Number(offer.id);
    const quantity = Number(offer.quantity);
    if (!offersByProduct.has(productId) ||
      !Number.isSafeInteger(id) || id <= 0 ||
      !Number.isFinite(quantity) || quantity <= 0 ||
      offer.is_available !== true || offer.is_hidden === true ||
      offer.warehouse_active === false || offer.supplier_active === false) {
      continue;
    }
    offersByProduct.get(productId).push({
      id,
      productId,
      quantity,
      isAvailable: true
    });
  }

  return products.map(product => ({
    product: {
      id: Number(product.id),
      article: String(product.article || "").slice(0, 100),
      name: String(product.name || "Запчастина").slice(0, 250)
    },
    offers: offersByProduct.get(Number(product.id))
  })).filter(card => card.offers.length > 0);
}
