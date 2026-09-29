import {
  pool,
} from "../config/db.js";
import {
  normalizeReturnPolicyNote,
  normalizeReturnPolicyOverride,
  ReturnPolicyService,
} from "./ReturnPolicyService.js";


function positiveInteger(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}


export const AdminProductService = {
  async getReturnPolicy(productIdValue, offerIdValue = null, db = pool) {
    const productId = positiveInteger(productIdValue);
    if (!productId) throw new Error("Некоректний товар");
    const offerId = offerIdValue === null || offerIdValue === undefined
      ? null
      : positiveInteger(offerIdValue);
    if (offerIdValue !== null && offerIdValue !== undefined && !offerId) {
      throw new Error("Некоректна пропозиція");
    }

    const result = await db.query(
      `SELECT
         p.id,
         p.return_policy_override AS product_return_policy_override,
         p.return_policy_note AS product_return_policy_note,
         po.return_policy_override AS offer_return_policy_override,
         w.return_policy_override AS warehouse_return_policy_override
       FROM products p
       LEFT JOIN product_offers po
         ON po.product_id = p.id
        AND po.id = $2
       LEFT JOIN warehouses w ON w.id = po.warehouse_id
       WHERE p.id = $1
         AND ($2::integer IS NULL OR po.id IS NOT NULL)
       LIMIT 1`,
      [productId, offerId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Товар не знайдено");
    return {
      productId,
      returnPolicyOverride: row.product_return_policy_override,
      returnPolicyNote: row.product_return_policy_note,
      effectiveReturnPolicy: ReturnPolicyService.resolveRow(row),
    };
  },

  async setReturnPolicy(productIdValue, data = {}, db = pool) {
    const productId = positiveInteger(productIdValue);
    if (!productId) throw new Error("Некоректний товар");
    const returnPolicyOverride = normalizeReturnPolicyOverride(
      data.returnPolicyOverride
    );
    const returnPolicyNote = normalizeReturnPolicyNote(data.returnPolicyNote);
    const updated = await db.query(
      `UPDATE products
       SET return_policy_override = $2,
           return_policy_note = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id`,
      [productId, returnPolicyOverride, returnPolicyNote]
    );
    if (!updated.rows[0]) throw new Error("Товар не знайдено");
    return this.getReturnPolicy(productId, data.offerId ?? null, db);
  },

  async permanentlyRemove(
    productIdValue,
    removedByUserId,
    db = pool
  ) {
    const productId = positiveInteger(
      productIdValue
    );

    if (!productId) {
      throw new Error("Некоректний товар");
    }

    const client =
      typeof db.connect === "function"
        ? await db.connect()
        : db;

    const shouldRelease =
      client !== db &&
      typeof client.release === "function";

    try {
      await client.query("BEGIN");

      const productResult =
        await client.query(
          `
            SELECT id, article, name, is_active
            FROM products
            WHERE id = $1
            FOR UPDATE
          `,
          [productId]
        );

      const product =
        productResult.rows[0];

      if (!product || product.is_active !== true) {
        throw new Error("Товар не знайдено або вже видалено");
      }

      const stockResult =
        await client.query(
          `
            SELECT 1
            FROM product_offers po
            LEFT JOIN warehouses w
              ON w.id = po.warehouse_id
            LEFT JOIN suppliers s
              ON s.id = COALESCE(
                po.supplier_id,
                w.supplier_id
              )
            WHERE po.product_id = $1
              AND po.is_available = TRUE
              AND po.is_hidden = FALSE
              AND po.quantity > 0
              AND (w.id IS NULL OR w.is_active = TRUE)
              AND (s.id IS NULL OR s.is_active = TRUE)
            LIMIT 1
          `,
          [productId]
        );

      if (stockResult.rowCount > 0) {
        const error = new Error(
          "Неможливо видалити товар, який є в наявності"
        );
        error.statusCode = 409;
        throw error;
      }

      await client.query(
        `
          UPDATE products
          SET
            is_active = FALSE,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [productId]
      );

      await client.query(
        `
          UPDATE product_offers
          SET
            is_available = FALSE,
            is_hidden = TRUE,
            updated_at = CURRENT_TIMESTAMP
          WHERE product_id = $1
        `,
        [productId]
      );

      await client.query(
        `
          INSERT INTO product_removal_log (
            product_id,
            article,
            product_name,
            removed_by_user_id
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (product_id)
          DO UPDATE SET
            article = EXCLUDED.article,
            product_name = EXCLUDED.product_name,
            removed_by_user_id = EXCLUDED.removed_by_user_id,
            removed_at = CURRENT_TIMESTAMP
        `,
        [
          productId,
          product.article,
          product.name,
          positiveInteger(removedByUserId),
        ]
      );

      await client.query("COMMIT");

      return {
        productId,
        article: product.article,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  },
};
