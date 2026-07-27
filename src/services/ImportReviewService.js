import { pool } from "../config/db.js";

import { ProductRepository }
from "../repositories/ProductRepository.js";

import { ImportNewProductRepository }
from "../repositories/ImportNewProductRepository.js";

function positiveInteger(
  value,
  errorMessage
) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    throw new Error(errorMessage);
  }

  return number;
}

function nullablePositiveInteger(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return positiveInteger(
    value,
    "Некорректный номер склада"
  );
}

function mapReview(row) {
  return {
    id: Number(row.id),
    warehouseId:
      Number(row.warehouse_id),
    supplierId:
      row.supplier_id === null
        ? null
        : Number(row.supplier_id),
    warehouseSupplierImportId:
      row.warehouse_supplier_import_id ===
      null
        ? null
        : Number(
            row
              .warehouse_supplier_import_id
          ),
    brandId: Number(row.brand_id),
    brandName:
      row.brand_name ?? null,
    article: row.article,
    articleNormalized:
      row.article_normalized,
    name: row.name,
    price: Number(row.price),
    quantity: Number(row.quantity),
    status: row.status,
    warehouseName:
      row.warehouse_name ?? null,
    warehouseCity:
      row.warehouse_city ?? null,
    supplierName:
      row.supplier_name ?? null,
    firstImportId:
      row.first_import_id === null
        ? null
        : Number(row.first_import_id),
    latestImportId:
      row.latest_import_id === null
        ? null
        : Number(row.latest_import_id),
    latestImportRowId:
      row.latest_import_row_id === null
        ? null
        : Number(
            row.latest_import_row_id
          ),
    productId:
      row.product_id === null
        ? null
        : Number(row.product_id),
    productOfferId:
      row.product_offer_id === null
        ? null
        : Number(row.product_offer_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function mapReportRow(row) {
  return {
    id: Number(row.id),
    sourceRowNumber:
      row.source_row_number === null
        ? null
        : Number(row.source_row_number),
    article: row.article,
    name: row.name,
    brand: row.brand,
    price:
      row.price === null
        ? null
        : Number(row.price),
    quantity:
      row.quantity === null
        ? null
        : Number(row.quantity),
    status: row.status,
    errorMessage: row.error_message,
    productOfferId:
      row.product_offer_id === null
        ? null
        : Number(row.product_offer_id),
    oldPrice:
      row.old_price === null
        ? null
        : Number(row.old_price),
    newPrice:
      row.new_price === null
        ? null
        : Number(row.new_price),
    changePercent:
      row.change_percent === null
        ? null
        : Number(row.change_percent),
    oldQuantity:
      row.old_quantity === null
        ? null
        : Number(row.old_quantity),
    newQuantity:
      row.new_quantity === null
        ? null
        : Number(row.new_quantity),
    quantityChange:
      row.quantity_change === null
        ? null
        : Number(row.quantity_change),
    rawData: row.raw_data,
    createdAt: row.created_at,
  };
}

async function approveLockedRow(
  row,
  db
) {
  let product =
    await ProductRepository
      .findByBrandAndArticle(
        Number(row.brand_id),
        row.article_normalized,
        db
      );

  if (!product) {
    product =
      await ProductRepository
        .createProduct(
          {
            brandId:
              Number(row.brand_id),
            article: row.article,
            articleNormalized:
              row.article_normalized,
            name: row.name,
          },
          db
        );
  }

  let offer =
    await ProductRepository
      .findOfferByProductAndWarehouse(
        Number(product.id),
        Number(row.warehouse_id),
        db
      );

  if (offer) {
    offer =
      await ProductRepository
        .updateOfferStock(
          Number(offer.id),
          {
            quantity:
              Number(row.quantity),
            purchasePrice:
              Number(row.price),
          },
          db
        );
  } else {
    offer =
      await ProductRepository
        .createOffer(
          {
            productId:
              Number(product.id),
            warehouseId:
              Number(row.warehouse_id),
            supplierId:
              row.supplier_id === null
                ? null
                : Number(
                    row.supplier_id
                  ),
            quantity:
              Number(row.quantity),
            purchasePrice:
              Number(row.price),
            sourceType: "SUPPLIER",
          },
          db
        );
  }

  if (!offer) {
    throw new Error(
      "Не удалось создать предложение нового товара"
    );
  }

  const resolved =
    await ImportNewProductRepository
      .markResolved(
        {
          id: Number(row.id),
          status: "APPROVED",
          productId:
            Number(product.id),
          productOfferId:
            Number(offer.id),
        },
        db
      );

  await ImportNewProductRepository
    .updateLatestImportRow(
      {
        importRowId:
          row.latest_import_row_id,
        status: "APPROVED",
        productOfferId:
          Number(offer.id),
      },
      db
    );

  if (row.status === "PENDING") {
    await ImportNewProductRepository
      .decrementPendingImportCount(
        row.latest_import_id,
        db
      );
  }

  return resolved;
}

export const ImportReviewService = {
  async getPending({
    warehouseId = null,
    page = 1,
    pageSize = 50,
  } = {}) {
    const normalizedWarehouseId =
      nullablePositiveInteger(
        warehouseId
      );

    const normalizedPage =
      positiveInteger(
        page,
        "Некорректный номер страницы"
      );

    const normalizedPageSize =
      Math.min(
        positiveInteger(
          pageSize,
          "Некорректный размер страницы"
        ),
        200
      );

    const result =
      await ImportNewProductRepository
        .findPending({
          warehouseId:
            normalizedWarehouseId,
          page: normalizedPage,
          pageSize:
            normalizedPageSize,
        });

    return {
      items:
        result.rows.map(mapReview),
      pagination: {
        page: normalizedPage,
        pageSize:
          normalizedPageSize,
        total: result.total,
        totalPages: Math.max(
          1,
          Math.ceil(
            result.total /
            normalizedPageSize
          )
        ),
      },
    };
  },

  async approve(reviewIdValue) {
    const reviewId = positiveInteger(
      reviewIdValue,
      "Некорректный номер нового товара"
    );

    const db = await pool.connect();

    try {
      await db.query("BEGIN");

      const row =
        await ImportNewProductRepository
          .findByIdForUpdate(
            reviewId,
            db
          );

      if (!row) {
        throw new Error(
          "Новый товар не найден"
        );
      }

      if (row.status === "APPROVED") {
        await db.query("COMMIT");
        return mapReview(row);
      }

      const resolved =
        await approveLockedRow(
          row,
          db
        );

      await db.query("COMMIT");

      return mapReview(resolved);
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  },

  async approveAll(warehouseIdValue) {
    const warehouseId = positiveInteger(
      warehouseIdValue,
      "Некорректный номер склада"
    );

    const db = await pool.connect();

    try {
      await db.query("BEGIN");

      const rows =
        await ImportNewProductRepository
          .findPendingByWarehouseForUpdate(
            warehouseId,
            db
          );

      const approved = [];

      for (const row of rows) {
        approved.push(
          await approveLockedRow(
            row,
            db
          )
        );
      }

      await db.query("COMMIT");

      return {
        approvedCount:
          approved.length,
        items:
          approved.map(mapReview),
      };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  },

  async reject(reviewIdValue) {
    const reviewId = positiveInteger(
      reviewIdValue,
      "Некорректный номер нового товара"
    );

    const db = await pool.connect();

    try {
      await db.query("BEGIN");

      const row =
        await ImportNewProductRepository
          .findByIdForUpdate(
            reviewId,
            db
          );

      if (!row) {
        throw new Error(
          "Новый товар не найден"
        );
      }

      const resolved =
        await ImportNewProductRepository
          .markResolved(
            {
              id: reviewId,
              status: "REJECTED",
            },
            db
          );

      await ImportNewProductRepository
        .updateLatestImportRow(
          {
            importRowId:
              row.latest_import_row_id,
            status: "REJECTED",
          },
          db
        );

      if (row.status === "PENDING") {
        await ImportNewProductRepository
          .decrementPendingImportCount(
            row.latest_import_id,
            db
          );
      }

      await db.query("COMMIT");

      return mapReview(resolved);
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  },

  async getReport(
    importIdValue,
    warehouseIdValue
  ) {
    const importId = positiveInteger(
      importIdValue,
      "Некорректный номер импорта"
    );

    const warehouseId = positiveInteger(
      warehouseIdValue,
      "Некорректный номер склада"
    );

    const result =
      await ImportNewProductRepository
        .findReport({
          importId,
          warehouseId,
        });

    if (!result) {
      throw new Error(
        "Отчёт импорта не найден"
      );
    }

    const source =
      result.importRow;

    const rows =
      result.rows.map(mapReportRow);

    return {
      import: {
        id: Number(source.id),
        warehouseId:
          Number(source.warehouse_id),
        supplierId:
          source.supplier_id === null
            ? null
            : Number(
                source.supplier_id
              ),
        warehouseSupplierImportId:
          source.warehouse_supplier_import_id ===
          null
            ? null
            : Number(
                source
                  .warehouse_supplier_import_id
              ),
        fileName: source.file_name,
        fileType: source.file_type,
        importMethod:
          source.import_method,
        status: source.status,
        totalRows:
          Number(source.total_rows ?? 0),
        successRows:
          Number(
            source.success_rows ?? 0
          ),
        errorRows:
          Number(source.error_rows ?? 0),
        newProductsCount:
          Number(
            source.new_products_count ?? 0
          ),
        pendingNewProductsCount:
          Number(
            source
              .pending_new_products_count ??
            0
          ),
        ignoredNewProductsCount:
          Number(
            source
              .ignored_new_products_count ??
            0
          ),
        priceChangesCount:
          Number(
            source.price_changes_count ?? 0
          ),
        priceDropCount:
          Number(
            source.price_drop_count ?? 0
          ),
        priceRiseCount:
          Number(
            source.price_rise_count ?? 0
          ),
        createdAt: source.created_at,
      },
      newProducts:
        rows.filter(
          (row) =>
            row.status ===
              "PENDING_REVIEW" ||
            row.status ===
              "NEW_REJECTED" ||
            row.status ===
              "NEW_IGNORED" ||
            row.status ===
              "NEW_AUTO" ||
            row.status ===
              "APPROVED" ||
            row.status ===
              "REJECTED"
        ),
      priceDrops:
        rows.filter(
          (row) =>
            row.status ===
            "PRICE_DROP_ALERT"
        ),
      priceRises:
        rows.filter(
          (row) =>
            row.status ===
            "PRICE_RISE_ALERT"
        ),
      errors:
        rows.filter(
          (row) =>
            row.status === "ERROR"
        ),
    };
  },
};
