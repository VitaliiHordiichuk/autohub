import {
  transaction,
} from "../db/transaction.js";

import {
  AdminWarehouseOfferRepository,
} from "../repositories/AdminWarehouseOfferRepository.js";

import {
  normalizeArticle,
} from "./articleEngine/normalize.js";



import {
  ArticleNumberService,
} from "./ArticleNumberService.js";

const ALLOWED_STATUSES =
  new Set([
    "ALL",
    "ACTIVE",
    "HIDDEN",
    "IN_STOCK",
    "OUT_OF_STOCK",
    "MANUAL",
  ]);


const ALLOWED_LOCALES =
  new Set([
    "uk",
    "en",
    "ru",
  ]);


function normalizeLocale(value) {
  const locale =
    String(value || "uk")
      .trim()
      .toLowerCase();

  if (!ALLOWED_LOCALES.has(locale)) {
    return "uk";
  }

  return locale;
}


const CYRILLIC_TO_LATIN =
  Object.freeze({
    "А": "A",
    "В": "B",
    "Е": "E",
    "К": "K",
    "М": "M",
    "Н": "H",
    "О": "O",
    "Р": "P",
    "С": "C",
    "Т": "T",
    "Х": "X",
  });


function normalizeArticleSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(
      /[АВЕКМНОРСТХ]/g,
      (letter) =>
        CYRILLIC_TO_LATIN[letter]
    )
    .replace(/[^A-Z0-9]/g, "");
}


function createError(
  message,
  statusCode = 400
) {
  const error = new Error(message);
  error.statusCode = statusCode;

  return error;
}


function parsePositiveInteger(
  value,
  fieldName
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    throw createError(
      `${fieldName}: некорректное значение`
    );
  }

  return parsed;
}


function parseChangedBy(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return parsePositiveInteger(
    value,
    "changedBy"
  );
}


function parseManualPrice(value) {
  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed <= 0
  ) {
    throw createError(
      "Ручная цена должна быть больше нуля"
    );
  }

  return Number(parsed.toFixed(2));
}


function normalizeRequiredText(
  value,
  fieldName,
  maxLength
) {
  const text =
    String(value ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ");

  if (!text) {
    throw createError(
      `${fieldName}: поле обязательно`
    );
  }

  if (text.length > maxLength) {
    throw createError(
      `${fieldName}: превышена допустимая длина`
    );
  }

  return text;
}


function parseNonNegativeNumber(
  value,
  fieldName
) {
  const parsed =
    Number(
      String(value ?? "")
        .replace(",", ".")
        .trim()
    );

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    throw createError(
      `${fieldName}: должно быть числом не меньше нуля`
    );
  }

  return Number(
    parsed.toFixed(2)
  );
}


function normalizeStatus(value) {
  const status =
    String(value || "ALL")
      .trim()
      .toUpperCase();

  if (!ALLOWED_STATUSES.has(status)) {
    throw createError(
      "Неизвестный фильтр статуса"
    );
  }

  return status;
}


function normalizePage(value) {
  const page = Number(value || 1);

  if (
    !Number.isInteger(page) ||
    page <= 0
  ) {
    return 1;
  }

  return page;
}


function normalizeLimit(value) {
  const limit = Number(value || 100);

  if (
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    return 100;
  }

  return Math.min(limit, 200);
}


function toNumberOrNull(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? Number(parsed.toFixed(2))
    : null;
}


function mapOffer(row) {
  return {
    id: Number(row.id),
    productId:
      Number(row.product_id),

    warehouseId:
      row.warehouse_id === null
        ? null
        : Number(row.warehouse_id),

    supplierId:
      row.supplier_id === null
        ? null
        : Number(row.supplier_id),

    article: row.article,
    articleNormalized:
      row.article_normalized,

    name:
      row.localized_name ??
      row.name ??
      row.source_name,

    sourceName:
      row.source_name ??
      row.name ??
      null,

    translationLocale:
      row.translation_language_code ??
      null,

    manufacturer:
      row.manufacturer_name ?? null,

    warehouse: {
      name:
        row.warehouse_name ?? null,
      city:
        row.warehouse_city ?? null,
    },

    supplier:
      row.supplier_name ?? null,

    quantity:
      Number(row.quantity),

    reservedQuantity:
      Number(row.reserved_quantity || 0),

    freeQuantity:
      Number(row.free_quantity ?? row.quantity),

    reservations:
      Array.isArray(row.reservation_details)
        ? row.reservation_details.map((reservation) => ({
            orderId:
              reservation.orderId === null
                ? null
                : Number(reservation.orderId),
            quantity: Number(reservation.quantity || 0),
            orderStatus: reservation.orderStatus ?? null,
            customerName: reservation.customerName ?? null,
            customerEmail: reservation.customerEmail ?? null,
            customerPhone: reservation.customerPhone ?? null,
          }))
        : [],

    purchasePrice:
      toNumberOrNull(
        row.purchase_price
      ),

    automaticRetailPrice:
      toNumberOrNull(
        row.automatic_retail_price ??
        row.retail_price
      ),

    manualRetailPrice:
      toNumberOrNull(
        row.manual_retail_price
      ),

    sitePrice:
      toNumberOrNull(
        row.effective_retail_price
      ),

    priceMode:
      row.price_mode,

    deliveryDays:
      Number(row.delivery_days || 0),

    sourceType:
      row.source_type,

    isAvailable:
      row.is_available === true,

    isHidden:
      row.is_hidden === true,

    manualPriceUpdatedAt:
      row.manual_price_updated_at ??
      null,

    hiddenAt:
      row.hidden_at ?? null,

    updatedAt:
      row.updated_at ?? null,
  };
}


function pricesDiffer(
  oldPrice,
  newPrice
) {
  if (
    oldPrice === null &&
    newPrice === null
  ) {
    return false;
  }

  if (
    oldPrice === null ||
    newPrice === null
  ) {
    return true;
  }

  return Number(oldPrice) !==
    Number(newPrice);
}


function calculateChangePercent(
  oldPrice,
  newPrice
) {
  if (
    oldPrice === null ||
    newPrice === null ||
    Number(oldPrice) === 0
  ) {
    return null;
  }

  return Number(
    (
      (
        Number(newPrice) -
        Number(oldPrice)
      ) /
      Number(oldPrice) *
      100
    ).toFixed(2)
  );
}


async function requireWarehouse(
  warehouseId,
  db
) {
  const warehouse =
    await AdminWarehouseOfferRepository
      .findWarehouseById(
        warehouseId,
        db
      );

  if (!warehouse) {
    throw createError(
      "Склад не найден",
      404
    );
  }

  return warehouse;
}


async function requireOfferForUpdate(
  {
    warehouseId,
    offerId,
  },
  db
) {
  const offer =
    await AdminWarehouseOfferRepository
      .findOfferForUpdate(
        {
          warehouseId,
          offerId,
        },
        db
      );

  if (!offer) {
    throw createError(
      "Позиция склада не найдена",
      404
    );
  }

  return offer;
}


export const AdminWarehouseOfferService = {
  async listOffers({
    warehouseId,
    search,
    status,
    locale,
    page,
    limit,
  }) {
    const normalizedWarehouseId =
      parsePositiveInteger(
        warehouseId,
        "warehouseId"
      );

    const normalizedSearch =
      String(search || "")
        .trim()
        .slice(0, 200);

    const normalizedArticleSearch =
      normalizeArticleSearch(
        normalizedSearch
      );

    const normalizedStatus =
      normalizeStatus(status);

    const normalizedLocale =
      normalizeLocale(locale);

    const normalizedPage =
      normalizePage(page);

    const normalizedLimit =
      normalizeLimit(limit);

    const warehouse =
      await requireWarehouse(
        normalizedWarehouseId
      );

    const result =
      await AdminWarehouseOfferRepository
        .listByWarehouseId({
          warehouseId:
            normalizedWarehouseId,

          search:
            normalizedSearch,

          normalizedSearch:
            normalizedArticleSearch,

          status:
            normalizedStatus,

          locale:
            normalizedLocale,

          page:
            normalizedPage,

          limit:
            normalizedLimit,
        });

    return {
      warehouse: {
        id:
          Number(warehouse.id),

        name:
          warehouse.name,

        city:
          warehouse.city,

        isActive:
          warehouse.is_active === true,
      },

      filter: {
        search:
          normalizedSearch,

        status:
          normalizedStatus,

        locale:
          normalizedLocale,
      },

      pagination: {
        page:
          normalizedPage,

        limit:
          normalizedLimit,

        total:
          Number(result.total),

        warehouseTotal:
          Number(result.warehouseTotal),

        pages:
          Math.ceil(
            Number(result.total) /
            normalizedLimit
          ),
      },

      offers:
        result.rows.map(mapOffer),
    };
  },


  async addManualPosition({
    warehouseId,
    brandId,
    article,
    name,
    quantity,
    purchasePrice,
  }) {
    const normalizedWarehouseId =
      parsePositiveInteger(
        warehouseId,
        "warehouseId"
      );

    const normalizedBrandId =
      parsePositiveInteger(
        brandId,
        "brandId"
      );

    const normalizedArticle =
      normalizeRequiredText(
        article,
        "Артикул",
        100
      );


    const sourceArticleNormalized =
      normalizeArticle(
        normalizedArticle
      );

    if (!sourceArticleNormalized) {
      throw createError(
        "После нормализации артикул оказался пустым"
      );
    }

    const normalizedName =
      normalizeRequiredText(
        name,
        "Название",
        255
      );

    const normalizedQuantity =
      parseNonNegativeNumber(
        quantity,
        "Количество"
      );

    const normalizedPurchasePrice =
      parseNonNegativeNumber(
        purchasePrice,
        "Цена"
      );

    return transaction(async (db) => {
      const warehouse =
        await requireWarehouse(
          normalizedWarehouseId,
          db
        );

      const brand =
        await AdminWarehouseOfferRepository
          .findBrandById(
            normalizedBrandId,
            db
          );

      if (
        !brand ||
        brand.is_active !== true
      ) {
        throw createError(
          "Бренд не найден или отключён",
          404
        );
      }

      const articleResolution =
        await ArticleNumberService
          .resolveForImport({
            brandId:
              normalizedBrandId,
            article:
              normalizedArticle,
            db,
          });

      const resolvedBrandId =
        articleResolution.brandId;

      const articleForProduct =
        articleResolution.article;

      const articleNormalized =
        articleResolution
          .articleNormalized;


      let product =
        await ArticleNumberService
          .findOrPromoteProduct({
            resolution:
              articleResolution,
            db,
          });

      let productCreated = false;

      if (!product) {
        product =
          await AdminWarehouseOfferRepository
            .createProduct(
              {
                brandId:
                  resolvedBrandId,

                article:
                  articleForProduct,

                articleNormalized,

                name:
                  normalizedName,
              },
              db
            );

        productCreated = true;
      }

      const existingOffer =
        await AdminWarehouseOfferRepository
          .findOfferByProductAndWarehouseForUpdate(
            {
              productId:
                Number(product.id),

              warehouseId:
                normalizedWarehouseId,
            },
            db
          );

      const supplierId =
        warehouse.supplier_id === null
          ? null
          : Number(
              warehouse.supplier_id
            );

      const sourceType =
        supplierId !== null
          ? "SUPPLIER"
          : "OWN_STOCK";

      const deliveryDays =
        Number(
          warehouse.delivery_days ?? 0
        );

      let offer;

      if (existingOffer) {
        offer =
          await AdminWarehouseOfferRepository
            .updateManualOffer(
              {
                offerId:
                  Number(
                    existingOffer.id
                  ),

                supplierId,
                quantity:
                  normalizedQuantity,

                purchasePrice:
                  normalizedPurchasePrice,

                deliveryDays,
                sourceType,
              },
              db
            );
      } else {
        offer =
          await AdminWarehouseOfferRepository
            .createManualOffer(
              {
                productId:
                  Number(product.id),

                warehouseId:
                  normalizedWarehouseId,

                supplierId,
                quantity:
                  normalizedQuantity,

                purchasePrice:
                  normalizedPurchasePrice,

                deliveryDays,
                sourceType,
              },
              db
            );
      }

      return {
        created:
          !existingOffer,

        productCreated,

        product: {
          id:
            Number(product.id),

          brandId:
            normalizedBrandId,

          article:
            product.article,

          articleNormalized:
            product.article_normalized,

          name:
            product.name,
        },

        offer: {
          id:
            Number(offer.id),

          warehouseId:
            normalizedWarehouseId,

          supplierId,
          quantity:
            Number(offer.quantity),

          purchasePrice:
            toNumberOrNull(
              offer.purchase_price
            ),

          sourceType:
            offer.source_type,

          isAvailable:
            offer.is_available === true,

          isHidden:
            offer.is_hidden === true,
        },
      };
    });
  },


  async removeUntilNextImport({
    warehouseId,
    offerId,
  }) {
    const normalizedWarehouseId =
      parsePositiveInteger(
        warehouseId,
        "warehouseId"
      );

    const normalizedOfferId =
      parsePositiveInteger(
        offerId,
        "offerId"
      );

    return transaction(async (db) => {
      await requireWarehouse(
        normalizedWarehouseId,
        db
      );

      const oldOffer =
        await requireOfferForUpdate(
          {
            warehouseId:
              normalizedWarehouseId,

            offerId:
              normalizedOfferId,
          },
          db
        );

      const updated =
        await AdminWarehouseOfferRepository
          .removeUntilNextImport(
            normalizedOfferId,
            db
          );

      return {
        offer: mapOffer({
          ...oldOffer,
          ...updated,

          automatic_retail_price:
            updated.retail_price,

          effective_retail_price:
            updated.price_mode ===
              "MANUAL"
              ? updated.manual_retail_price
              : updated.retail_price,
        }),
      };
    });
  },


  async setManualPrice({
    warehouseId,
    offerId,
    price,
    changedBy,
  }) {
    const normalizedWarehouseId =
      parsePositiveInteger(
        warehouseId,
        "warehouseId"
      );

    const normalizedOfferId =
      parsePositiveInteger(
        offerId,
        "offerId"
      );

    const normalizedPrice =
      parseManualPrice(price);

    const normalizedChangedBy =
      parseChangedBy(changedBy);

    return transaction(async (db) => {
      await requireWarehouse(
        normalizedWarehouseId,
        db
      );

      const oldOffer =
        await requireOfferForUpdate(
          {
            warehouseId:
              normalizedWarehouseId,

            offerId:
              normalizedOfferId,
          },
          db
        );

      const oldEffectivePrice =
        toNumberOrNull(
          oldOffer.effective_retail_price
        );

      const updated =
        await AdminWarehouseOfferRepository
          .setManualPrice(
            {
              offerId:
                normalizedOfferId,

              price:
                normalizedPrice,
            },
            db
          );

      let history = null;

      if (
        pricesDiffer(
          oldEffectivePrice,
          normalizedPrice
        )
      ) {
        history =
          await AdminWarehouseOfferRepository
            .addPriceHistory(
              {
                productId:
                  Number(
                    oldOffer.product_id
                  ),

                offerId:
                  normalizedOfferId,

                oldPrice:
                  oldEffectivePrice,

                newPrice:
                  normalizedPrice,

                changedBy:
                  normalizedChangedBy,

                changePercent:
                  calculateChangePercent(
                    oldEffectivePrice,
                    normalizedPrice
                  ),
              },
              db
            );
      }

      return {
        offer: mapOffer({
          ...oldOffer,
          ...updated,

          automatic_retail_price:
            updated.retail_price,

          effective_retail_price:
            updated.manual_retail_price,
        }),

        history,
      };
    });
  },


  async resetAutomaticPrice({
    warehouseId,
    offerId,
    changedBy,
  }) {
    const normalizedWarehouseId =
      parsePositiveInteger(
        warehouseId,
        "warehouseId"
      );

    const normalizedOfferId =
      parsePositiveInteger(
        offerId,
        "offerId"
      );

    const normalizedChangedBy =
      parseChangedBy(changedBy);

    return transaction(async (db) => {
      await requireWarehouse(
        normalizedWarehouseId,
        db
      );

      const oldOffer =
        await requireOfferForUpdate(
          {
            warehouseId:
              normalizedWarehouseId,

            offerId:
              normalizedOfferId,
          },
          db
        );

      const oldEffectivePrice =
        toNumberOrNull(
          oldOffer.effective_retail_price
        );

      const automaticPrice =
        toNumberOrNull(
          oldOffer.retail_price
        );

      const updated =
        await AdminWarehouseOfferRepository
          .resetAutomaticPrice(
            normalizedOfferId,
            db
          );

      let history = null;

      if (
        pricesDiffer(
          oldEffectivePrice,
          automaticPrice
        )
      ) {
        history =
          await AdminWarehouseOfferRepository
            .addPriceHistory(
              {
                productId:
                  Number(
                    oldOffer.product_id
                  ),

                offerId:
                  normalizedOfferId,

                oldPrice:
                  oldEffectivePrice,

                newPrice:
                  automaticPrice,

                changedBy:
                  normalizedChangedBy,

                changePercent:
                  calculateChangePercent(
                    oldEffectivePrice,
                    automaticPrice
                  ),
              },
              db
            );
      }

      return {
        offer: mapOffer({
          ...oldOffer,
          ...updated,

          automatic_retail_price:
            updated.retail_price,

          effective_retail_price:
            updated.retail_price,
        }),

        history,
      };
    });
  },


  async setVisibility({
    warehouseId,
    offerId,
    hidden,
  }) {
    const normalizedWarehouseId =
      parsePositiveInteger(
        warehouseId,
        "warehouseId"
      );

    const normalizedOfferId =
      parsePositiveInteger(
        offerId,
        "offerId"
      );

    if (typeof hidden !== "boolean") {
      throw createError(
        "Поле hidden должно быть true или false"
      );
    }

    return transaction(async (db) => {
      await requireWarehouse(
        normalizedWarehouseId,
        db
      );

      const oldOffer =
        await requireOfferForUpdate(
          {
            warehouseId:
              normalizedWarehouseId,

            offerId:
              normalizedOfferId,
          },
          db
        );

      const updated =
        await AdminWarehouseOfferRepository
          .setVisibility(
            {
              offerId:
                normalizedOfferId,

              hidden,
            },
            db
          );

      return {
        offer: mapOffer({
          ...oldOffer,
          ...updated,

          automatic_retail_price:
            updated.retail_price,

          effective_retail_price:
            updated.price_mode ===
              "MANUAL"
              ? updated.manual_retail_price
              : updated.retail_price,
        }),
      };
    });
  },


  async getPriceHistory({
    warehouseId,
    offerId,
    limit,
  }) {
    const normalizedWarehouseId =
      parsePositiveInteger(
        warehouseId,
        "warehouseId"
      );

    const normalizedOfferId =
      parsePositiveInteger(
        offerId,
        "offerId"
      );

    const normalizedLimit =
      Math.min(
        normalizeLimit(limit),
        100
      );

    await requireWarehouse(
      normalizedWarehouseId
    );

    const history =
      await AdminWarehouseOfferRepository
        .listPriceHistory({
          warehouseId:
            normalizedWarehouseId,

          offerId:
            normalizedOfferId,

          limit:
            normalizedLimit,
        });

    return history.map((row) => ({
      id: Number(row.id),

      productId:
        Number(row.product_id),

      productOfferId:
        Number(row.product_offer_id),

      oldPrice:
        toNumberOrNull(
          row.old_price
        ),

      newPrice:
        toNumberOrNull(
          row.new_price
        ),

      changePercent:
        toNumberOrNull(
          row.change_percent
        ),

      changedBy:
        row.changed_by === null
          ? null
          : Number(row.changed_by),

      createdAt:
        row.created_at,
    }));
  },
};
