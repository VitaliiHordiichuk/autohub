import {
  validateSpecialOrderInquiry,
} from "./SpecialOrderInquiryPolicy.js";

import {
  readWebsiteArticleSearch,
} from "./WebsiteArticleSearchService.js";

import { isEligiblePublicOffer } from "./OfferService.js";
import { specialOrderArticle } from "./SpecialOrderArticlePolicy.js";
import { specialOrderInquiriesEnabled } from "./SpecialOrderInquiryFeature.js";

import {
  SpecialOrderInquiryRepository,
} from "../repositories/SpecialOrderInquiryRepository.js";

import { transaction } from "../db/transaction.js";
import { enqueueSpecialOrderInquiryNotification } from "../repositories/SpecialOrderInquiryOutboxRepository.js";

function fail(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function validateAccountId(value) {
  if (value == null) return null;

  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    fail("INVALID_ACCOUNT_CONTEXT", "Некоректний клієнт");
  }

  return id;
}

/** Recheck the exact ACTIVE TXT revision in the shared site/Telegram search model. */
export function trustedInquiry(response, article) {
  const inquiry = response?.specialOrder;
  const requested = specialOrderArticle(article);
  const received = specialOrderArticle(inquiry?.article);
  if (!requested || !received ||
      requested.normalized !== received.normalized ||
      inquiry?.articleNormalized !== requested.normalized ||
      inquiry.sourceType !== "SPECIAL_ORDER" ||
      inquiry.sourceKey !== "mercedes-txt" ||
      !Number.isSafeInteger(inquiry.importId) || inquiry.importId < 1 ||
      inquiry.availabilityStatus !== "ON_REQUEST" ||
      inquiry.currency !== "UAH" ||
      inquiry.quantity !== null || inquiry.isAvailable !== false ||
      inquiry.checkoutEnabled !== false ||
      inquiry.requiresConfirmation !== true ||
      typeof inquiry.indicativePriceUah !== "number") return null;

  const price = inquiry.indicativePriceUah;
  if (!Number.isFinite(price) || price <= 0 || price > 9999999999.99) return null;
  const rounded = Math.round(price * 100) / 100;
  return rounded > 0 ? rounded : null;
}

function hasEligibleWebsiteOffers(publicResult) {
  const visited = new Set();
  const stack = [publicResult?.productCard, publicResult?.replacementSourceCard,
    ...(publicResult?.family || [])];
  while (stack.length) {
    const card = stack.pop();
    if (!card || typeof card !== "object" || visited.has(card)) continue;
    visited.add(card);
    if (Array.isArray(card.offers) && card.offers.some(isEligiblePublicOffer)) return true;
    for (const key of ["analogs", "replacements"]) {
      if (Array.isArray(card[key])) stack.push(...card[key]);
    }
  }
  return false;
}

export async function createSpecialOrderInquiry({
  input,
  userId = null,
  source = "WEBSITE",
  availabilityContext = null,
}, deps = {}) {

  const enabled = deps.enabled === undefined
    ? specialOrderInquiriesEnabled()
    : deps.enabled === true;

  // An accidentally mounted route cannot activate the feature.
  if (!enabled) {
    fail(
      "SPECIAL_ORDER_DISABLED",
      "Запити під замовлення тимчасово недоступні",
      503
    );
  }

  if (!["WEBSITE", "MAKATRON"].includes(source)) {
    fail("INVALID_SOURCE", "Некоректне джерело заявки");
  }

  const accountId = validateAccountId(userId);
  const inquiry = validateSpecialOrderInquiry(input);

  // Never override the public TXT feature flag: inactive revisions must stay invisible.
  const read = deps.readSearch || readWebsiteArticleSearch;

  // Never trust the client's submitted price, product ID or group.
  // Resolve inventory, alternatives, and the separate supplier TXT price again.
  const result = await read({
    article: inquiry.article,
    requestedLocale: inquiry.locale,
    userId: accountId,
    includeSourceDetails: false,
    availabilityContext,
  });

  const publicResult = result?.publicResult ?? {
    productCard: result?.response?.productCard ?? null,
    family: result?.response?.family ?? [],
    replacementSourceCard:
      result?.response?.replacement?.sourceProductCard ?? null,
  };

  if (hasEligibleWebsiteOffers(publicResult)) {
    fail(
      "AVAILABLE_CATALOG_OFFER",
      "Товар уже має доступну пропозицію MAKA або постачальника",
      409
    );
  }

  if (result?.found !== true) {
    fail(
      "SPECIAL_ORDER_NOT_FOUND",
      "Артикул недоступний для запиту під замовлення",
      409
    );
  }

  const unitPrice = trustedInquiry(
    result.response,
    inquiry.article
  );

  if (unitPrice === null) {
    fail(
      "SPECIAL_ORDER_NOT_FOUND",
      "Підтвердженої пропозиції TXT немає",
      409
    );
  }

  const repository = deps.repository ||
    SpecialOrderInquiryRepository;

  const runTransaction = deps.runTransaction || transaction;

  const created = await runTransaction(async db => {
    await repository.lockPhone(inquiry.contactPhone, db);

    const counts = await repository.recentCounts({
      phone: inquiry.contactPhone,
      article: inquiry.article,
    }, db);

    if (counts.duplicateCount > 0) {
      fail(
        "DUPLICATE_INQUIRY",
        "Таку заявку вже надіслано",
        429
      );
    }

    if (counts.hourCount >= 3 || counts.dayCount >= 10) {
      fail(
        "INQUIRY_RATE_LIMIT",
        "Забагато заявок за короткий час",
        429
      );
    }

    const saved = await repository.create({
      userId: accountId,
      article: inquiry.article,
      contactPhone: inquiry.contactPhone,
      contactName: inquiry.contactName,
      quantity: inquiry.quantity,
      locale: inquiry.locale,
      source,
      estimatedUnitPriceUah: unitPrice,
    }, db);
    if (!saved?.id) throw new Error("Special-order inquiry was not persisted");
    // Same SQL connection/transaction: the inquiry can never commit without its event.
    const enqueue = deps.enqueue || enqueueSpecialOrderInquiryNotification;
    await enqueue(saved.id, db);
    return saved;
  });

  if (!created?.id) {
    throw new Error("Special-order inquiry was not persisted");
  }

  // Notification is delivered by the explicitly enabled durable outbox worker.
  // Never send from the HTTP request process.

  // Only safe public fields. Never return stored contact details.
  return {
    id: Number(created.id),
    article: inquiry.article,
    quantity: inquiry.quantity,
    status: created.status,
    estimatedUnitPriceUah: unitPrice,
    currency: "UAH",
    requiresManagerConfirmation: true,
    createdAt: created.created_at ?? null,
  };
}
