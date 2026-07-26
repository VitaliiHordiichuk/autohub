

import { pool } from "../config/db.js";

import { WarehouseSupplierImportRepository }
from "../repositories/WarehouseSupplierImportRepository.js";

import { ProductRepository }
from "../repositories/ProductRepository.js";

import { ImportRepository }
from "../repositories/ImportRepository.js";


import { BrandAliasRepository }
from "../repositories/BrandAliasRepository.js";


import { normalizeArticle }
from "./articleEngine/normalize.js";


function normalizeImportContext(importContext) {
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


  const warehouseId =
    Number(importContext.warehouseId);

  const warehouseSupplierImportId =
    importContext.warehouseSupplierImportId === null ||
    importContext.warehouseSupplierImportId === undefined
      ? null
      : Number(
          importContext.warehouseSupplierImportId
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


  const text =
    String(value).trim();


  if (!text) {
    return null;
  }


  return text.slice(
    0,
    maxLength
  );
}


function toNullableNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const text =
    String(value)
      .trim()
      .replace(",", ".");


  if (!text) {
    return null;
  }


  const number =
    Number(text);


  return Number.isFinite(number)
    ? number
    : null;
}


function buildSafeErrorRow(errorRow) {
  return {
    article:
      toNullableText(
        errorRow?.article,
        100
      ),

    name:
      toNullableText(
        errorRow?.name,
        255
      ),

    price:
      toNullableNumber(
        errorRow?.price
      ),

    quantity:
      toNullableNumber(
        errorRow?.quantity
      ),

    brand:
      toNullableText(
        errorRow?.brand,
        100
      ),

    errorMessage:
      errorRow?.error ||
      errorRow?.errorMessage ||
      "Неизвестная ошибка строки",
  };
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


    const db =
      await pool.connect();


    try {

      await db.query("BEGIN");


      const warehouseSupplierImport =
        context.warehouseSupplierImportId
          ? await WarehouseSupplierImportRepository
              .findById(
                context.warehouseSupplierImportId,
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
          warehouseSupplierImport.warehouse_id
        ) !== context.warehouseId
      ) {
        throw new Error(
          "Настройка импорта не принадлежит указанному складу"
        );
      }


      if (
        warehouseSupplierImport.is_active !== true
      ) {
        throw new Error(
          "Настройка импорта отключена"
        );
      }


      const supplierId =
        Number(
          warehouseSupplierImport.supplier_id
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


      const fileType =
        String(
          context.fileType ||
          settings.file_type ||
          "CSV"
        ).toUpperCase();


      const importMethod =
        String(
          context.importMethod ||
          settings.import_method ||
          "MANUAL"
        ).toUpperCase();


      const importRecord =
        await ImportRepository.createImport(
          {
            warehouseId:
              context.warehouseId,

            supplierId,

            warehouseSupplierImportId:
              warehouseSupplierImport.id,

            source:
              fileType,

            fileName:
              context.fileName,

            fileType,

            importMethod,
          },
          db
        );


      const result = {
        importId:
          importRecord.id,

        total:
          rows.length +
          importErrors.length,

        created:
          0,

        updated:
          0,

        errors:
          importErrors.length,

        priceChanges:
          0,

        successRows:
          0,

        missingOffersDisabled:
          0,

        replacementApplied:
          false,
      };


      const importedOfferIds =
        new Set();


      for (
        const errorRow
        of importErrors
      ) {

        const safeErrorRow =
          buildSafeErrorRow(
            errorRow
          );


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

              status:
                "ERROR",

              errorMessage:
                safeErrorRow.errorMessage,

              productOfferId:
                null,

              sourceRowNumber:
                Number.isInteger(
                  Number(
                    errorRow?.rowNumber
                  )
                )
                  ? Number(
                      errorRow.rowNumber
                    )
                  : null,

              rawData:
                errorRow?.rawData ?? null,
            },
            db
          );

      }


      for (
        let index = 0;
        index < rows.length;
        index++
      ) {

        const row =
          rows[index];

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
            brandId =
              settings.fixed_brand_id;
          }


          if (
            settings.brand_mode ===
            "FROM_FILE"
          ) {
            const brandText =
              String(
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


            brandId =
              Number(
                matchedBrand.brand_id
              );
          }


          if (!brandId) {
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


          let productWasCreated =
            false;


          if (!product) {

            product =
              await ProductRepository
                .createProduct(
                  {
                    brandId,

                    article:
                      row.article,

                    articleNormalized,

                    name:
                      row.name,
                  },
                  db
                );


            productWasCreated =
              true;

          }


          const existingOffer =
            await ProductRepository
              .findOfferByProductAndWarehouse(
                product.id,
                context.warehouseId,
                db
              );


          let productOfferId;

          let offerWasUpdated =
            false;

          let priceWasChanged =
            false;


          if (existingOffer) {

            const oldPrice =
              existingOffer.purchase_price;


            const updatedOffer =
              await ProductRepository
                .updateOfferStock(
                  existingOffer.id,
                  {
                    quantity:
                      row.quantity,

                    purchasePrice:
                      row.price,
                  },
                  db
                );


            if (!updatedOffer) {
              throw new Error(
                "Не удалось обновить предложение товара"
              );
            }


            productOfferId =
              existingOffer.id;

            offerWasUpdated =
              true;


            priceWasChanged =
              Number(oldPrice) !==
              Number(row.price);

          } else {

            const newOffer =
              await ProductRepository
                .createOffer(
                  {
                    productId:
                      product.id,

                    warehouseId:
                      context.warehouseId,

                    supplierId,

                    quantity:
                      row.quantity,

                    purchasePrice:
                      row.price,

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


            productOfferId =
              newOffer.id;

          }


          await ImportRepository
            .createImportRow(
              {
                importId:
                  importRecord.id,

                article:
                  row.article,

                name:
                  row.name,

                price:
                  row.price,

                quantity:
                  row.quantity,

                brand:
                  row.brand,

                status:
                  "IMPORTED",

                errorMessage:
                  null,

                productOfferId,
              },
              db
            );


          importedOfferIds.add(
            Number(productOfferId)
          );


          await db.query(
            `RELEASE SAVEPOINT ${savepointName}`
          );


          if (productWasCreated) {
            result.created++;
          }


          if (offerWasUpdated) {
            result.updated++;
          }


          if (priceWasChanged) {
            result.priceChanges++;
          }


          result.successRows++;


        } catch(error) {

          await db.query(
            `ROLLBACK TO SAVEPOINT ${savepointName}`
          );


          const safeErrorRow =
            buildSafeErrorRow({
              article:
                row?.article,

              name:
                row?.name,

              price:
                row?.price,

              quantity:
                row?.quantity,

              brand:
                row?.brand,

              error:
                error.message,
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

                status:
                  "ERROR",

                errorMessage:
                  safeErrorRow.errorMessage,

                productOfferId:
                  null,

                sourceRowNumber:
                  Number.isInteger(
                    Number(
                      row?.rowNumber
                    )
                  )
                    ? Number(
                        row.rowNumber
                      )
                    : null,

                rawData:
                  row?.rawData ?? null,
              },
              db
            );


          await db.query(
            `RELEASE SAVEPOINT ${savepointName}`
          );


          result.errors++;

        }

      }


      if (
        result.successRows > 0
      ) {
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


        result.missingOffersDisabled =
          disabledOffers.length;

        result.replacementApplied =
          true;
      }


      await ImportRepository
        .updateImportResult(
          {
            importId:
              importRecord.id,

            totalRows:
              result.total,

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
          },
          db
        );


      result.importId =
        Number(importRecord.id);

      await db.query("COMMIT");

      return result;


    } catch(error) {

      await db.query("ROLLBACK");

      throw error;


    } finally {

      db.release();

    }

  },


};