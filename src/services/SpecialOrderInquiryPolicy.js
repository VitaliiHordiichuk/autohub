import { specialOrderArticle } from "./SpecialOrderArticlePolicy.js";

function reject(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  throw error;
}

export function normalizeInquiryPhone(value) {
  const raw = String(value ?? "").trim();

  if (!raw || raw.length > 32) {
    reject("PHONE_INVALID", "Вкажіть номер телефону");
  }

  const compact = raw.replace(/[\s()-]/g, "");

  let phone;

  if (/^0\d{9}$/.test(compact)) {
    phone = "+38" + compact;
  } else if (/^380\d{9}$/.test(compact)) {
    phone = "+" + compact;
  } else {
    phone = compact;
  }

  if (!/^\+380\d{9}$/.test(phone)) {
    reject("PHONE_INVALID", "Вкажіть український номер +380");
  }

  return phone;
}

export function validateSpecialOrderInquiry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    reject("INVALID_REQUEST", "Некоректна заявка");
  }

  // Hidden form field: legitimate customers never fill it.
  if (String(input.website ?? "").trim()) {
    reject("REQUEST_REJECTED", "Не вдалося надіслати заявку");
  }

  if (input.consent !== true) {
    reject("CONSENT_REQUIRED", "Потрібна згода на обробку даних");
  }

  const article = specialOrderArticle(input.article);

  if (!article) {
    reject("ARTICLE_INVALID", "Некоректний артикул");
  }

  const phone = normalizeInquiryPhone(input.phone);

  const rawName = String(input.name ?? "").trim();

  if (
    rawName.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(rawName)
  ) {
    reject("NAME_INVALID", "Некоректне ім'я");
  }

  const quantity = input.quantity == null
    ? 1
    : Number(input.quantity);

  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 20
  ) {
    reject("QUANTITY_INVALID", "Кількість має бути від 1 до 20");
  }

  const locale = ["uk", "ru", "en"].includes(input.locale)
    ? input.locale
    : "uk";

  return {
    article: article.normalized,
    contactPhone: phone,
    contactName: rawName || null,
    quantity,
    locale,
    source: "WEBSITE",
    status: "NEW",
    requiresManagerConfirmation: true,
    consent: true,
  };
}
