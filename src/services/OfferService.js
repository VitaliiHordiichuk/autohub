import { ProductRepository } from "../repositories/ProductRepository.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { ReturnPolicyService } from "./ReturnPolicyService.js";


function formatQuantity(quantity) {
  const numericQuantity =
    Number(quantity);

  if (
    !Number.isFinite(
      numericQuantity
    )
  ) {
    return 0;
  }

  return numericQuantity;
}


function formatPrice(price) {
  if (
    price === null ||
    price === undefined
  ) {
    return null;
  }

  const numericPrice =
    Number(price);

  if (
    !Number.isFinite(
      numericPrice
    )
  ) {
    return null;
  }

  return Number(
    numericPrice.toFixed(2)
  );
}


function formatPriority(value) {
  const priority = Number(value);

  if (
    !Number.isInteger(priority) ||
    priority <= 0
  ) {
    return null;
  }

  return priority;
}


export function isEligiblePublicOffer(offer) {
  const price = Number(offer?.retailPrice);

  return offer?.isAvailable === true
    && Number(offer?.quantity) > 0
    && Number.isFinite(price)
    && price > 0;
}


export function eligiblePublicOffers(offers) {
  return (offers || []).filter(
    isEligiblePublicOffer
  );
}


export function selectPrimaryPublicOffer(offers) {
  return eligiblePublicOffers(offers)[0] || null;
}


const OFFER_TEXT = {
  uk: {
    ownStock: "Наш склад",
    partnerStock: "Доступно під замовлення",
    unavailable: "Немає пропозицій",
    availableToday: "В наявності",
    onOrder: "Під замовлення",
    delivery: (days) => `Доставка ${days} дн.`,
    available: "В наявності",
    reserved: "У резерві",
    reservedForYou: "Зарезервовано для вас",
  },
  en: {
    ownStock: "Our stock",
    partnerStock: "Available to order",
    unavailable: "No offers",
    availableToday: "In stock",
    onOrder: "Available to order",
    delivery: (days) => `Delivery in ${days} days`,
    available: "In stock",
    reserved: "Reserved",
    reservedForYou: "Reserved for you",
  },
  ru: {
    ownStock: "Наш склад",
    partnerStock: "Доступно под заказ",
    unavailable: "Нет предложений",
    availableToday: "В наличии",
    onOrder: "Под заказ",
    delivery: (days) => `Доставка ${days} дн.`,
    available: "В наличии",
    reserved: "В резерве",
    reservedForYou: "Зарезервировано для вас",
  },
};


export const OFFER_AVAILABILITY = Object.freeze({
  AVAILABLE: "AVAILABLE",
  ON_ORDER: "ON_ORDER",
  RESERVED: "RESERVED",
  RESERVED_FOR_YOU: "RESERVED_FOR_YOU",
  UNAVAILABLE: "UNAVAILABLE",
});

export function resolveOfferAvailability(offer, sourceType = offer.source_type) {
  const quantity = formatQuantity(offer.quantity);
  const stockQuantity = formatQuantity(offer.stock_quantity ?? offer.quantity);
  const reservedQuantity = formatQuantity(offer.reserved_quantity);
  const ownReservedQuantity = formatQuantity(offer.own_reserved_quantity);

  if (offer.is_available !== true || offer.is_hidden === true || stockQuantity <= 0) {
    return OFFER_AVAILABILITY.UNAVAILABLE;
  }

  if (quantity > 0) {
    return sourceType === "SUPPLIER"
      ? OFFER_AVAILABILITY.ON_ORDER
      : OFFER_AVAILABILITY.AVAILABLE;
  }

  if (reservedQuantity >= stockQuantity) {
    return ownReservedQuantity > 0
      ? OFFER_AVAILABILITY.RESERVED_FOR_YOU
      : OFFER_AVAILABILITY.RESERVED;
  }

  return OFFER_AVAILABILITY.UNAVAILABLE;
}

function buildAvailabilityText(offer, availabilityStatus, locale = "uk") {
  const quantity =
    formatQuantity(
      offer.quantity
    );

  const text =
    OFFER_TEXT[locale] ||
    OFFER_TEXT.uk;

  if (availabilityStatus === OFFER_AVAILABILITY.RESERVED_FOR_YOU) {
    return text.reservedForYou;
  }

  if (availabilityStatus === OFFER_AVAILABILITY.RESERVED) {
    return text.reserved;
  }

  if (availabilityStatus === OFFER_AVAILABILITY.UNAVAILABLE) {
    return text.unavailable;
  }

  if (
    offer.source_type ===
    "OWN_STOCK"
  ) {
    return text.availableToday;
  }

  if (
    offer.source_type ===
    "SUPPLIER"
  ) {
    const deliveryDays =
      Number(
        offer.delivery_days
      ) || 0;

    if (deliveryDays <= 0) {
      return text.onOrder;
    }

    return text.delivery(deliveryDays);
  }

  return quantity > 0
    ? text.available
    : text.unavailable;
}


function mapOffer(offer, pricingContext, locale) {
  const quantity =
    formatQuantity(
      offer.quantity
    );

  const supplierType =
    String(
      offer.supplier_type || ""
    )
      .trim()
      .toUpperCase();

  const sourceType =
    supplierType === "OWN"
      ? "OWN_STOCK"
      : supplierType === "PARTNER"
        ? "SUPPLIER"
        : offer.source_type;

  const availabilityStatus = resolveOfferAvailability(offer, sourceType);

  const customerPricing = CustomerPricingService.price({
    retailPrice: offer.retail_price,
    minimumSalePrice: offer.minimum_sale_price,
  }, pricingContext);

  const priceMatrix = CustomerPricingService.priceMatrix({
    retailPrice: offer.retail_price,
    minimumSalePrice: offer.minimum_sale_price,
  }, pricingContext);

  const returnPolicy = ReturnPolicyService.resolveRow(offer);
  const mappedOffer = {
    id:
      Number(offer.id),

    productId:
      Number(offer.product_id),

    sourceType,

    quantity,

    displayQuantity:
      quantity > 5
        ? ">5"
        : String(quantity),

    retailPrice:
      formatPrice(customerPricing?.customerPrice),

    priceMatrix,

    deliveryDays:
      Number(
        offer.delivery_days
      ) || 0,

    isAvailable:
      availabilityStatus === OFFER_AVAILABILITY.AVAILABLE ||
      availabilityStatus === OFFER_AVAILABILITY.ON_ORDER,

    availabilityStatus,

    reservationExpiresAt:
      availabilityStatus === OFFER_AVAILABILITY.RESERVED_FOR_YOU
        ? offer.own_reserved_until || null
        : null,

    returnPolicy,

    isReturnable:
      ReturnPolicyService.isReturnable(returnPolicy),

    warehousePriorityEnabled:
      offer
        .warehouse_priority_enabled ===
      true,

    warehouse:
      offer.warehouse_id
        ? {
            id:
              Number(
                offer.warehouse_id
              ),

            name:
              offer.warehouse_name,

            city:
              offer.warehouse_city,

            priority:
              formatPriority(
                offer.warehouse_priority
              ),
          }
        : null,

    supplier:
      offer.effective_supplier_id
        ? {
            id:
              Number(
                offer
                  .effective_supplier_id
              ),

            name:
              offer.supplier_name,

            type:
              supplierType || null,
          }
        : null,
  };

  return {
    ...mappedOffer,

    sourceLabel:
      sourceType === "OWN_STOCK"
        ? (OFFER_TEXT[locale] || OFFER_TEXT.uk).ownStock
        : (OFFER_TEXT[locale] || OFFER_TEXT.uk).partnerStock,

    availabilityText:
      buildAvailabilityText({
        ...offer,
        source_type:
          sourceType,
      }, availabilityStatus, locale),
  };
}


function sourceKey(offer) {
  if (offer.supplier?.id) {
    return (
      `supplier:${offer.supplier.id}`
    );
  }

  if (offer.warehouse?.id) {
    return (
      `warehouse:${offer.warehouse.id}`
    );
  }

  return `offer:${offer.id}`;
}


function applyWarehousePriorities(
  offers
) {
  const groups = new Map();

  for (const offer of offers) {
    const key =
      sourceKey(offer);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(offer);
  }

  const result = [];

  for (
    const group of groups.values()
  ) {
    const priorityEnabled =
      group.some(
        (offer) =>
          offer
            .warehousePriorityEnabled ===
          true
      );

    const everyOfferHasPriority =
      group.every(
        (offer) =>
          offer.warehouse
            ?.priority !== null &&
          offer.warehouse
            ?.priority !== undefined
      );

    if (
      !priorityEnabled ||
      !everyOfferHasPriority ||
      group.length <= 1
    ) {
      result.push(...group);
      continue;
    }

    const sorted = [...group].sort(
      (first, second) => {
        const priorityDifference =
          first.warehouse.priority -
          second.warehouse.priority;

        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        const firstPrice =
          first.retailPrice ??
          Number.POSITIVE_INFINITY;

        const secondPrice =
          second.retailPrice ??
          Number.POSITIVE_INFINITY;

        if (
          firstPrice !== secondPrice
        ) {
          return (
            firstPrice -
            secondPrice
          );
        }

        return first.id - second.id;
      }
    );

    result.push(sorted[0]);
  }

  return result;
}


export function presentOffers(
  offers,
  pricingContext = null,
  locale = "uk"
) {
  const mappedOffers =
    (offers || []).map(
      (offer) =>
        mapOffer(
          offer,
          pricingContext,
          locale
        )
    );

  return applyWarehousePriorities(
    mappedOffers
  );
}


export const OfferService = {
  async getOffersByProductIds(
    productIds,
    pricingContext = null,
    locale = "uk",
    availabilityContext = null
  ) {
    const normalizedProductIds = [
      ...new Set(
        (productIds || [])
          .map((productId) => Number(productId))
          .filter((productId) => Number.isInteger(productId) && productId > 0)
      ),
    ];

    const offersByProductId = new Map(
      normalizedProductIds.map(
        (productId) => [productId, []]
      )
    );

    if (normalizedProductIds.length === 0) {
      return offersByProductId;
    }

    const offers =
      await ProductRepository
        .findOffersByProductIds(
          normalizedProductIds,
          availabilityContext
        );

    for (const offer of offers) {
      const productId =
        Number(offer.product_id);

      const productOffers =
        offersByProductId.get(productId);

      if (productOffers) {
        productOffers.push(offer);
      }
    }

    for (const productId of normalizedProductIds) {
      offersByProductId.set(
        productId,
        presentOffers(
          offersByProductId.get(productId),
          pricingContext,
          locale
        )
      );
    }

    return offersByProductId;
  },

  async getOffersByProductId(
    productId,
    pricingContext = null,
    locale = "uk",
    availabilityContext = null
  ) {
    const offersByProductId =
      await OfferService
        .getOffersByProductIds(
          [productId],
          pricingContext,
          locale,
          availabilityContext
        );

    return offersByProductId.get(
      Number(productId)
    ) || [];
  },
};
