import { ProductRepository } from "../repositories/ProductRepository.js";


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


function buildAvailabilityText(offer) {
  const quantity =
    formatQuantity(
      offer.quantity
    );

  if (
    offer.source_type ===
    "OWN_STOCK"
  ) {
    if (quantity <= 0) {
      return "Нет в наличии";
    }

    return "Есть сегодня";
  }

  if (
    offer.source_type ===
    "SUPPLIER"
  ) {
    if (quantity <= 0) {
      return "Нет в наличии";
    }

    const deliveryDays =
      Number(
        offer.delivery_days
      ) || 0;

    if (deliveryDays <= 0) {
      return "Под заказ";
    }

    return (
      `Доставка ${deliveryDays} дн.`
    );
  }

  return quantity > 0
    ? "В наличии"
    : "Нет в наличии";
}


function mapOffer(offer) {
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

    purchasePrice:
      formatPrice(
        offer.purchase_price
      ),

    retailPrice:
      formatPrice(
        offer.retail_price
      ),

    deliveryDays:
      Number(
        offer.delivery_days
      ) || 0,

    isAvailable:
      Boolean(
        offer.is_available
      ),

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

    availabilityText:
      buildAvailabilityText({
        ...offer,
        source_type:
          sourceType,
      }),
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


export const OfferService = {
  async getOffersByProductId(
    productId
  ) {
    const offers =
      await ProductRepository
        .findOffersByProductId(
          productId
        );

    const mappedOffers =
      offers.map(mapOffer);

    return applyWarehousePriorities(
      mappedOffers
    );
  },
};
