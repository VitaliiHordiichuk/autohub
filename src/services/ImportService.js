import { pool } from "../config/db.js";

import { WarehouseSupplierImportRepository }
from "../repositories/WarehouseSupplierImportRepository.js";

import { ProductRepository }
from "../repositories/ProductRepository.js";

import { ImportRepository }
from "../repositories/ImportRepository.js";

import { ImportNewProductRepository }
from "../repositories/ImportNewProductRepository.js";

import { BrandAliasRepository }
from "../repositories/BrandAliasRepository.js";

import { normalizeArticle }
from "./articleEngine/normalize.js";

import {
  calculatePriceChangePercent,
  classifyPriceChange,
  normalizeNewProductsMode,
  normalizePriceThreshold,
}
from "./ImportPolicyService.js";

function normalizeImportContext(
  importContext
) {
  if (
    Number.isInteger(importContext) &&
    importContext > 0
  ) {
    return {
      warehouseId: importContext,
      warehouseSupplierImportId: null,
      fileName: null,
      fileType: null,
      importMethod: null,
    };
  }

  if (
    !importContext ||
    typeof importContext !== "object"
  ) {
    throw new Error(
      "Не переданы параметры импорта"
    );
  }

  const warehouseId = Number(
    importContext.warehouseId
  );

  const warehouseSupplierImportId =
    importContext.warehouseSupplierImportId ===
      null ||
    importContext.warehouseSupplierImportId ===
      undefined
      ? null
      : Number(
          importContext
            .warehouseSupplierImportId
        );

  if (
    !Number.isInteger(warehouseId) ||
    warehouseId <= 0
  ) {
    throw new Error(
      "Некорректный номер склада"
    );
  }

  if (
    warehouseSupplierImportId !== null &&
    (
      !Number.isInteger(
        warehouseSupplierImportId
      ) ||
      warehouseSupplierImportId <= 0
    )
  ) {
    throw new Error(
      "Некорректный номер настройки импорта склада"
    );
  }

  return {
    warehouseId,
    warehouseSupplierImportId,
    fileName:
      importContext.fileName ?? null,
    fileType:
      importContext.fileType ?? null,
    importMethod:
      importContext.importMethod ?? null,
  };
}

function toNullableText(
  value,
  maxLength
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  return text.slice(0, maxLength);
}

function toNullableNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text = String(value)
    .trim()
    .replace(",", ".");

  if (!text) {
    return null;
  }

  const number = Number(text);

  return Number.isFinite(number)
    ? number
    : null;
}

function buildSafeErrorRow(errorRow) {
  return {
    article: toNullableText(
      errorRow?.article,
      100
    ),
    name: toNullableText(
      errorRow?.name,
      255
    ),
    price: toNullableNumber(
      errorRow?.price
    ),
    quantity: toNullableNumber(
      errorRow?.quantity
    ),
    brand: toNullableText(
      errorRow?.brand,
      100
    ),
    errorMessage:
      errorRow?.error ||
      errorRow?.errorMessage ||
      "Неизвестная ошибка строки",
  };
}

function numericOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function calculateQuantityChange(
  oldQuantity,
  newQuantity
) {
  const oldValue =
    numericOrNull(oldQuantity);
  const newValue =
    numericOrNull(newQuantity);

  if (
    oldValue === null ||
    newValue === null
  ) {
    return null;
  }

  return Number(
    (newValue - oldValue).toFixed(2)
  );
}

function sourceRowNumber(row) {
  const number = Number(
    row?.rowNumber
  );

  return Number.isInteger(number)
    ? number
    : null;
}

export const ImportService = {
  async importRows(
    importContext,
    rows,
    importErrors = []
  ) {
    const context =
      normalizeImportContext(
        importContext
      );

    if (!Array.isArray(rows)) {
      throw new Error(
        "Строки импорта должны быть массивом"
      );
    }

    if (!Array.isArray(importErrors)) {
      throw new Error(
        "Ошибки импорта должны быть массивом"
      );
    }

    const db = await pool.connect();

    try {
      await db.query("BEGIN");

      const warehouseSupplierImport =
        context.warehouseSupplierImportId
          ? await WarehouseSupplierImportRepository
              .findById(
                context
                  .warehouseSupplierImportId,
                db
              )
          : await WarehouseSupplierImportRepository
              .findByWarehouseId(
                context.warehouseId,
                db
              );

      if (!warehouseSupplierImport) {
        throw new Error(
          "Для склада не настроена активная связь с поставщиком"
        );
      }

      if (
        Number(
          warehouseSupplierImport
            .warehouse_id
        ) !== context.warehouseId
      ) {
        throw new Error(
          "Настройка импорта не принадлежит указанному складу"
        );
      }

      if (
        warehouseSupplierImport
          .is_active !== true
      ) {
        throw new Error(
          "Настройка импорта отключена"
        );
      }

      const supplierId = Number(
        warehouseSupplierImport
          .supplier_id
      );

      if (
        !Number.isInteger(supplierId) ||
        supplierId <= 0
      ) {
        throw new Error(
          "В настройке импорта не указан поставщик"
        );
      }

      const settings =
        warehouseSupplierImport;

      const fileType = String(
        context.fileType ||
        settings.file_type ||
        "CSV"
      ).toUpperCase();

      const importMethod = String(
        context.importMethod ||
        settings.import_method ||
        "MANUAL"
      ).toUpperCase();

      const newProductsMode =
        normalizeNewProductsMode(
          settings.new_products_mode,
          { fallback: "REVIEW" }
        );

      const priceDropThreshold =
        normalizePriceThreshold(
          settings.price_drop_threshold,
          "Порог снижения цены",
          { fallback: 30 }
        );

      const priceRiseThreshold =
        normalizePriceThreshold(
          settings.price_rise_threshold,
          "Порог роста цены",
          { fallback: 40 }
        );

      const importRecord =
        await ImportRepository
          .createImport(
            {
              warehouseId:
                context.warehouseId,
              supplierId,
              warehouseSupplierImportId:
                warehouseSupplierImport.id,
              source: fileType,
              fileName:
                context.fileName,
              fileType,
              importMethod,
            },
            db
          );

      const result = {
        importId:
          Number(importRecord.id),
        total:
          rows.length +
          importErrors.length,
        created: 0,
        updated: 0,
        errors:
          importErrors.length,
        priceChanges: 0,
        priceDrops: 0,
        priceRises: 0,
        newProducts: 0,
        pendingNewProducts: 0,
        ignoredNewProducts: 0,
        rejectedNewProducts: 0,
        successRows: 0,
        missingOffersDisabled: 0,
        missingPendingRemoved: 0,
        replacementApplied: false,
        newProductsMode,
        priceDropThreshold,
        priceRiseThreshold,
      };

      const importedOfferIds =
        new Set();

      const activePendingIds =
        new Set();

      for (const errorRow of importErrors) {
        const safeErrorRow =
          buildSafeErrorRow(errorRow);

        await ImportRepository
          .createImportRow(
            {
              importId:
                importRecord.id,
              article:
                safeErrorRow.article,
              name:
                safeErrorRow.name,
              price:
                safeErrorRow.price,
              quantity:
                safeErrorRow.quantity,
              brand:
                safeErrorRow.brand,
              status: "ERROR",
              errorMessage:
                safeErrorRow
                  .errorMessage,
              productOfferId: null,
              sourceRowNumber:
                sourceRowNumber(errorRow),
              rawData:
                errorRow?.rawData ?? null,
              newPrice:
                safeErrorRow.price,
              newQuantity:
                safeErrorRow.quantity,
            },
            db
          );
      }

      for (
        let index = 0;
        index < rows.length;
        index += 1
      ) {
        const row = rows[index];
        const savepointName =
          `import_row_${index + 1}`;

        await db.query(
          `SAVEPOINT ${savepointName}`
        );

        try {
          let brandId = null;

          if (
            settings.brand_mode ===
            "FIXED"
          ) {
            brandId = Number(
              settings.fixed_brand_id
            );
          }

          if (
            settings.brand_mode ===
            "FROM_FILE"
          ) {
            const brandText = String(
              row.brand ?? ""
            ).trim();

            if (!brandText) {
              throw new Error(
                "В строке не указан бренд"
              );
            }

            const matchedBrand =
              await BrandAliasRepository
                .findByAlias(
                  brandText,
                  db
                );

            if (!matchedBrand) {
              throw new Error(
                `Бренд «${brandText}» не найден`
              );
            }

            brandId = Number(
              matchedBrand.brand_id
            );
          }

          if (
            !Number.isInteger(brandId) ||
            brandId <= 0
          ) {
            throw new Error(
              "Не удалось определить бренд"
            );
          }

          const articleNormalized =
            normalizeArticle(
              row.article
            );

          if (!articleNormalized) {
            throw new Error(
              "После нормализации артикул оказался пустым"
            );
          }

          let product =
            await ProductRepository
              .findByBrandAndArticle(
                brandId,
                articleNormalized,
                db
              );

          let productWasCreated = false;

          if (!product) {
            result.newProducts += 1;

            if (
              newProductsMode ===
              "REVIEW"
            ) {
              const importRow =
                await ImportRepository
                  .createImportRow(
                    {
                      importId:
                        importRecord.id,
                      article:
                        row.article,
                      name: row.name,
                      price: row.price,
                      quantity:
                        row.quantity,
                      brand: row.brand,
                      status:
                        "PENDING_REVIEW",
                      errorMessage: null,
                      productOfferId:
                        null,
                      sourceRowNumber:
                        sourceRowNumber(row),
                      rawData:
                        row?.rawData ?? null,
                      oldPrice: null,
                      newPrice:
                        row.price,
                      changePercent:
                        null,
                      oldQuantity:
                        null,
                      newQuantity:
                        row.quantity,
                      quantityChange:
                        null,
                    },
                    db
                  );

              const pending =
                await ImportNewProductRepository
                  .upsertPending(
                    {
                      warehouseId:
                        context.warehouseId,
                      supplierId,
                      warehouseSupplierImportId:
                        Number(
                          warehouseSupplierImport.id
                        ),
                      brandId,
                      article:
                        row.article,
                      articleNormalized,
                      name: row.name,
                      price: row.price,
                      quantity:
                        row.quantity,
                      importId:
                        Number(
                          importRecord.id
                        ),
                      importRowId:
                        Number(
                          importRow.id
                        ),
                    },
                    db
                  );

              if (
                pending.status ===
                "PENDING"
              ) {
                activePendingIds.add(
                  Number(pending.id)
                );

                result
                  .pendingNewProducts += 1;
              } else {
                const rowStatus =
                  pending.status ===
                  "REJECTED"
                    ? "NEW_REJECTED"
                    : "APPROVED";

                await ImportRepository
                  .updateImportRowStatus(
                    {
                      importRowId:
                        Number(
                          importRow.id
                        ),
                      status: rowStatus,
                      productOfferId:
                        pending
                          .product_offer_id,
                    },
                    db
                  );

                if (
                  pending.status ===
                  "REJECTED"
                ) {
                  result
                    .rejectedNewProducts += 1;
                }
              }

              result.successRows += 1;

              await db.query(
                `RELEASE SAVEPOINT ${savepointName}`
              );

              continue;
            }

            if (
              newProductsMode ===
              "IGNORE"
            ) {
              await ImportRepository
                .createImportRow(
                  {
                    importId:
                      importRecord.id,
                    article:
                      row.article,
                    name: row.name,
                    price: row.price,
                    quantity:
                      row.quantity,
                    brand: row.brand,
                    status:
                      "NEW_IGNORED",
                    errorMessage: null,
                    productOfferId:
                      null,
                    sourceRowNumber:
                      sourceRowNumber(row),
                    rawData:
                      row?.rawData ?? null,
                    oldPrice: null,
                    newPrice:
                      row.price,
                    changePercent:
                      null,
                    oldQuantity:
                      null,
                    newQuantity:
                      row.quantity,
                    quantityChange:
                      null,
                  },
                  db
                );

              result
                .ignoredNewProducts += 1;
              result.successRows += 1;

              await db.query(
                `RELEASE SAVEPOINT ${savepointName}`
              );

              continue;
            }

            product =
              await ProductRepository
                .createProduct(
                  {
                    brandId,
                    article:
                      row.article,
                    articleNormalized,
                    name: row.name,
                  },
                  db
                );

            productWasCreated = true;
          }

          const existingOffer =
            await ProductRepository
              .findOfferByProductAndWarehouse(
                Number(product.id),
                context.warehouseId,
                db
              );

          const oldPrice =
            existingOffer
              ? numericOrNull(
                  existingOffer
                    .purchase_price
                )
              : null;

          const oldQuantity =
            existingOffer
              ? numericOrNull(
                  existingOffer.quantity
                )
              : null;

          const newPrice = Number(
            row.price
          );

          const newQuantity = Number(
            row.quantity
          );

          const changePercent =
            calculatePriceChangePercent(
              oldPrice,
              newPrice
            );

          const quantityChange =
            calculateQuantityChange(
              oldQuantity,
              newQuantity
            );

          const priceStatus =
            classifyPriceChange({
              changePercent,
              dropThreshold:
                priceDropThreshold,
              riseThreshold:
                priceRiseThreshold,
            });

          let productOfferId;
          let offerWasUpdated = false;

          if (existingOffer) {
            const updatedOffer =
              await ProductRepository
                .updateOfferStock(
                  Number(
                    existingOffer.id
                  ),
                  {
                    quantity:
                      newQuantity,
                    purchasePrice:
                      newPrice,
                  },
                  db
                );

            if (!updatedOffer) {
              throw new Error(
                "Не удалось обновить предложение товара"
              );
            }

            productOfferId = Number(
              existingOffer.id
            );

            offerWasUpdated = true;
          } else {
            const newOffer =
              await ProductRepository
                .createOffer(
                  {
                    productId:
                      Number(product.id),
                    warehouseId:
                      context.warehouseId,
                    supplierId,
                    quantity:
                      newQuantity,
                    purchasePrice:
                      newPrice,
                    sourceType:
                      "SUPPLIER",
                  },
                  db
                );

            if (!newOffer) {
              throw new Error(
                "Не удалось создать предложение товара"
              );
            }

            productOfferId = Number(
              newOffer.id
            );
          }

          const priceWasChanged =
            oldPrice !== null &&
            Number(oldPrice) !==
              Number(newPrice);

          const importRowStatus =
            productWasCreated
              ? "NEW_AUTO"
              : priceStatus;

          await ImportRepository
            .createImportRow(
              {
                importId:
                  importRecord.id,
                article:
                  row.article,
                name: row.name,
                price: newPrice,
                quantity:
                  newQuantity,
                brand: row.brand,
                status:
                  importRowStatus,
                errorMessage: null,
                productOfferId,
                sourceRowNumber:
                  sourceRowNumber(row),
                rawData:
                  row?.rawData ?? null,
                oldPrice,
                newPrice,
                changePercent,
                oldQuantity,
                newQuantity,
                quantityChange,
              },
              db
            );

          importedOfferIds.add(
            productOfferId
          );

          if (productWasCreated) {
            result.created += 1;
          }

          if (offerWasUpdated) {
            result.updated += 1;
          }

          if (priceWasChanged) {
            result.priceChanges += 1;
          }

          if (
            priceStatus ===
            "PRICE_DROP_ALERT"
          ) {
            result.priceDrops += 1;
          }

          if (
            priceStatus ===
            "PRICE_RISE_ALERT"
          ) {
            result.priceRises += 1;
          }

          result.successRows += 1;

          await db.query(
            `RELEASE SAVEPOINT ${savepointName}`
          );
        } catch (error) {
          await db.query(
            `ROLLBACK TO SAVEPOINT ${savepointName}`
          );

          const safeErrorRow =
            buildSafeErrorRow({
              article: row?.article,
              name: row?.name,
              price: row?.price,
              quantity:
                row?.quantity,
              brand: row?.brand,
              error: error.message,
            });

          await ImportRepository
            .createImportRow(
              {
                importId:
                  importRecord.id,
                article:
                  safeErrorRow.article,
                name:
                  safeErrorRow.name,
                price:
                  safeErrorRow.price,
                quantity:
                  safeErrorRow.quantity,
                brand:
                  safeErrorRow.brand,
                status: "ERROR",
                errorMessage:
                  safeErrorRow
                    .errorMessage,
                productOfferId: null,
                sourceRowNumber:
                  sourceRowNumber(row),
                rawData:
                  row?.rawData ?? null,
                newPrice:
                  safeErrorRow.price,
                newQuantity:
                  safeErrorRow.quantity,
              },
              db
            );

          await db.query(
            `RELEASE SAVEPOINT ${savepointName}`
          );

          result.errors += 1;
        }
      }

      if (result.successRows > 0) {
        const disabledOffers =
          await ProductRepository
            .disableMissingSupplierOffers(
              {
                warehouseId:
                  context.warehouseId,
                supplierId,
                activeOfferIds:
                  Array.from(
                    importedOfferIds
                  ),
              },
              db
            );

        const removedPending =
          await ImportNewProductRepository
            .removeMissingPending(
              {
                warehouseId:
                  context.warehouseId,
                activeIds:
                  Array.from(
                    activePendingIds
                  ),
              },
              db
            );

        result.missingOffersDisabled =
          disabledOffers.length;

        result.missingPendingRemoved =
          removedPending.length;

        result.replacementApplied = true;
      }

      await ImportRepository
        .updateImportResult(
          {
            importId:
              importRecord.id,
            totalRows: result.total,
            successRows:
              result.successRows,
            errorRows:
              result.errors,
            status:
              result.successRows === 0
                ? "FAILED"
                : result.errors > 0
                  ? "COMPLETED_WITH_ERRORS"
                  : "COMPLETED",
            newProductsCount:
              result.newProducts,
            pendingNewProductsCount:
              result.pendingNewProducts,
            ignoredNewProductsCount:
              result.ignoredNewProducts,
            priceChangesCount:
              result.priceChanges,
            priceDropCount:
              result.priceDrops,
            priceRiseCount:
              result.priceRises,
          },
          db
        );

      await db.query("COMMIT");

      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  },
};
