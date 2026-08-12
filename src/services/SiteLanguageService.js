import {
  SiteLanguageRepository,
} from "../repositories/SiteLanguageRepository.js";

const LANGUAGE_CODE_PATTERN =
  /^[a-z]{2,5}$/;
const SITE_LANGUAGE_CODES = new Set(["uk", "en"]);

function normalizeCode(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase();

  if (
    !LANGUAGE_CODE_PATTERN.test(code)
  ) {
    throw new Error(
      "Некоректний код мови"
    );
  }

  return code;
}

function parseOptionalBoolean(
  value,
  fieldName
) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(
      `${fieldName} має бути true або false`
    );
  }

  return value;
}

function parseOptionalSortOrder(
  value
) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > 1000
  ) {
    throw new Error(
      "sortOrder має бути цілим числом від 0 до 1000"
    );
  }

  return parsed;
}

export class SiteLanguageService {
  static async getPublicLanguages() {
    const languages =
      await SiteLanguageRepository
        .findPublic();

    const defaultLanguage =
      languages.find(
        (language) =>
          language.isDefault
      ) || languages[0] || null;

    return {
      defaultLanguage:
        defaultLanguage?.code || null,
      languages,
    };
  }

  static async getAdminLanguages() {
    const languages =
      await SiteLanguageRepository
        .findAll();

    return {
      languages,
    };
  }

  static async updateLanguage(
    rawCode,
    body = {}
  ) {
    const code =
      normalizeCode(rawCode);

    if (
      !SITE_LANGUAGE_CODES.has(code) &&
      (body.isPublicEnabled === true || body.isAdminEnabled === true || body.isDefault === true)
    ) {
      throw new Error("На сайті доступні лише українська та англійська мови");
    }

    const current =
      await SiteLanguageRepository
        .findByCode(code);

    if (!current) {
      throw new Error(
        "Мову не знайдено"
      );
    }

    const changes = {
      isPublicEnabled:
        parseOptionalBoolean(
          body.isPublicEnabled,
          "isPublicEnabled"
        ),

      isAdminEnabled:
        parseOptionalBoolean(
          body.isAdminEnabled,
          "isAdminEnabled"
        ),

      isDefault:
        parseOptionalBoolean(
          body.isDefault,
          "isDefault"
        ),

      sortOrder:
        parseOptionalSortOrder(
          body.sortOrder
        ),
    };

    const hasChanges =
      Object.values(changes)
        .some(
          (value) =>
            value !== undefined
        );

    if (!hasChanges) {
      throw new Error(
        "Не передано жодної зміни"
      );
    }

    if (
      changes.isDefault === false &&
      current.isDefault
    ) {
      throw new Error(
        "Спочатку виберіть іншу основну мову"
      );
    }

    if (
      current.isDefault &&
      changes.isPublicEnabled === false
    ) {
      throw new Error(
        "Основну мову не можна вимкнути для клієнтів"
      );
    }

    if (
      changes.isDefault === true &&
      changes.isPublicEnabled === false
    ) {
      throw new Error(
        "Основна мова має бути доступною для клієнтів"
      );
    }

    return SiteLanguageRepository
      .update(code, changes);
  }
}
