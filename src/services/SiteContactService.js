import { SiteContactRepository } from "../repositories/SiteContactRepository.js";

function contactError(message, statusCode = 400, code = "SITE_CONTACT_INVALID") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function normalizeUkrainianPhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const compact = raw.replace(/[\s()-]/g, "");
  if (!/^\+380\d{9}$/.test(compact)) {
    throw contactError("Вкажіть номер у форматі +380 XX XXX XX XX");
  }

  return compact;
}

export function formatUkrainianPhone(value) {
  const phone = normalizeUkrainianPhone(value);
  if (!phone) return null;
  return `${phone.slice(0, 4)} ${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9, 11)} ${phone.slice(11, 13)}`;
}

function present(row) {
  const phone = row?.phone_e164 ?? null;
  return {
    phone,
    displayPhone: formatUkrainianPhone(phone),
    updatedAt: row?.updated_at ?? null,
  };
}

export const SiteContactService = {
  async getPublic(db) {
    const contact = present(await SiteContactRepository.get(db));
    return {
      phone: contact.phone,
      displayPhone: contact.displayPhone,
    };
  },

  async getAdmin(db) {
    return present(await SiteContactRepository.get(db));
  },

  async update({ phone, changedBy }, db) {
    const normalizedPhone = normalizeUkrainianPhone(phone);
    return present(await SiteContactRepository.update({
      phone: normalizedPhone,
      updatedBy: changedBy,
    }, db));
  },
};
