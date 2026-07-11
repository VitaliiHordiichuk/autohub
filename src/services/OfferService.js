import { ProductRepository } from "../repositories/ProductRepository.js";

function formatQuantity(quantity) {
  const numericQuantity = Number(quantity);

  if (!Number.isFinite(numericQuantity)) {
    return 0;
  }

  return numericQuantity;
}

function formatPrice(price) {
  if (price === null || price === undefined) {
    return null;
  }

  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice)) {
    return null;
  }

  return Number(numericPrice.toFixed(2));
}

function buildAvailabilityText(offer) {
  const quantity = formatQuantity(offer.quantity);

  if (offer.source_type === "OWN_STOCK") {
    if (quantity <= 0) {
      return "Нет в наличии";
    }

    return "Есть сегодня";
  }

  if (offer.source_type === "SUPPLIER") {
    if (quantity <= 0) {
      return "Нет в наличии";
    }

    const deliveryDays = Number(offer.delivery_days) || 0;

    if (deliveryDays <= 0) {
      return "Под заказ";
    }

    return `Доставка ${deliveryDays} дн.`;
  }

  return quantity > 0 ? "В наличии" : "Нет в наличии";
}

function mapOffer(offer) {
  const quantity = formatQuantity(offer.quantity);

  return {
    id: offer.id,
    productId: offer.product_id,
    sourceType: offer.source_type,
    quantity,
    displayQuantity: quantity > 5 ? ">5" : String(quantity),
    purchasePrice: formatPrice(offer.purchase_price),
    retailPrice: formatPrice(offer.retail_price),
    deliveryDays: Number(offer.delivery_days) || 0,
    isAvailable: Boolean(offer.is_available),

    warehouse: offer.warehouse_name
      ? {
          name: offer.warehouse_name,
          city: offer.warehouse_city,
        }
      : null,

    supplier: offer.supplier_name
      ? {
          name: offer.supplier_name,
        }
      : null,

    availabilityText: buildAvailabilityText(offer),
  };
}

export const OfferService = {
  async getOffersByProductId(productId) {
    const offers =
      await ProductRepository.findOffersByProductId(productId);

    return offers.map(mapOffer);
  },
};