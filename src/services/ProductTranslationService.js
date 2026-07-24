import {
  ProductTranslationRepository,
} from "../repositories/ProductTranslationRepository.js";


function createError(
  message,
  statusCode = 400
) {
  const error = new Error(message);
  error.statusCode = statusCode;

  return error;
}


function parseProductId(value) {
  const productId = Number(value);

  if (
    !Number.isInteger(productId) ||
    productId <= 0
  ) {
    throw createError(
      "Некоректний номер товару"
    );
  }

  return productId;
}


function normalizeLanguageCode(value) {
  const code =
    String(value || "")
      .trim()
      .toLowerCase();

  if (!/^[a-z]{2,5}$/.test(code)) {
    throw createError(
      "Некоректний код мови"
    );
  }

  return code;
}


function normalizeName(value) {
  const name =
    String(value || "")
      .trim();

  if (!name) {
    throw createError(
      "Назва товару не може бути порожньою"
    );
  }

  if (name.length > 500) {
    throw createError(
      "Назва товару занадто довга"
    );
  }

  return name;
}


function normalizeDescription(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const description =
    String(value).trim();

  return description || null;
}


async function requireProduct(
  productId
) {
  const product =
    await ProductTranslationRepository
      .findProductById(productId);

  if (!product) {
    throw createError(
      "Товар не знайдено",
      404
    );
  }

  return product;
}


async function requireLanguage(
  languageCode
) {
  const language =
    await ProductTranslationRepository
      .findLanguageByCode(
        languageCode
      );

  if (!language) {
    throw createError(
      "Мову не знайдено",
      404
    );
  }

  return language;
}


export const ProductTranslationService = {
  async list(productIdValue) {
    const productId =
      parseProductId(
        productIdValue
      );

    const product =
      await requireProduct(
        productId
      );

    const items =
      await ProductTranslationRepository
        .listLanguagesWithTranslations(
          productId
        );

    return {
      product: {
        id:
          Number(product.id),

        article:
          product.article,

        articleNormalized:
          product.article_normalized,

        sourceName:
          product.name,
      },

      items,
    };
  },


  async save(
    {
      productId:
        productIdValue,

      languageCode:
        languageCodeValue,

      name,
      description,
    }
  ) {
    const productId =
      parseProductId(
        productIdValue
      );

    const languageCode =
      normalizeLanguageCode(
        languageCodeValue
      );

    await requireProduct(
      productId
    );

    await requireLanguage(
      languageCode
    );

    return ProductTranslationRepository
      .upsert({
        productId,
        languageCode,

        name:
          normalizeName(name),

        description:
          normalizeDescription(
            description
          ),
      });
  },
};
