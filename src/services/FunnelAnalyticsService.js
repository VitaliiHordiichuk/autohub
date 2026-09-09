import {
  FunnelAnalyticsRepository,
} from "../repositories/FunnelAnalyticsRepository.js";

import {
  resolveAnalyticsSessionId,
  shouldRecordSearchAnalytics,
} from "./SearchAnalyticsService.js";


const EVENT_TYPES = new Set([
  "PRODUCT_VIEW",
  "ADD_TO_CART",
  "CHECKOUT_STARTED",
  "ORDER_CREATED",
  "VIN_REQUEST_CREATED",
]);

const PUBLIC_EVENT_TYPES = new Set([
  "PRODUCT_VIEW",
]);


function positiveInteger(value) {
  const numeric = Number(value);

  return Number.isInteger(numeric) && numeric > 0
    ? numeric
    : null;
}


function cleanText(value, maxLength) {
  const text = String(value ?? "").trim();

  return text
    ? text.slice(0, maxLength)
    : null;
}


export function normalizePublicFunnelEvent(input = {}) {
  const eventType = String(
    input.eventType ?? ""
  )
    .trim()
    .toUpperCase();

  if (!PUBLIC_EVENT_TYPES.has(eventType)) {
    const error = new Error(
      "Неподдерживаемый тип события аналитики"
    );
    error.statusCode = 400;
    throw error;
  }

  const productId = positiveInteger(
    input.productId
  );

  if (!productId) {
    const error = new Error(
      "productId является обязательным"
    );
    error.statusCode = 400;
    throw error;
  }

  return {
    eventType,
    productId,
    source:
      cleanText(input.source, 40),
    locale:
      cleanText(input.locale, 10),
  };
}


export const FunnelAnalyticsService = {
  async recordEvent({
    req,
    eventType,
    productId = null,
    productOfferId = null,
    cartId = null,
    checkoutId = null,
    orderId = null,
    vinRequestId = null,
    source = null,
    locale = null,
    requireIdentity = false,
  }) {
    const normalizedType = String(
      eventType ?? ""
    )
      .trim()
      .toUpperCase();

    if (
      !EVENT_TYPES.has(normalizedType) ||
      !shouldRecordSearchAnalytics(req)
    ) {
      return null;
    }

    const visitorSessionId =
      resolveAnalyticsSessionId(req);

    const userId =
      positiveInteger(
        req?.auth?.userId
      );

    if (
      requireIdentity &&
      !visitorSessionId &&
      !userId
    ) {
      return null;
    }

    return FunnelAnalyticsRepository
      .createEvent({
        eventType: normalizedType,
        visitorSessionId,
        userId,
        productId:
          positiveInteger(productId),
        productOfferId:
          positiveInteger(productOfferId),
        cartId:
          positiveInteger(cartId),
        checkoutId:
          positiveInteger(checkoutId),
        orderId:
          positiveInteger(orderId),
        vinRequestId:
          positiveInteger(vinRequestId),
        source:
          cleanText(source, 40),
        locale:
          cleanText(locale, 10),
      });
  },
};
