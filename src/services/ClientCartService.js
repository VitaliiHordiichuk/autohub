import {
  createHash,
} from "node:crypto";

import {
  pool,
} from "../config/db.js";


function createError(
  message,
  statusCode = 400
) {
  const error =
    new Error(message);

  error.statusCode =
    statusCode;

  return error;
}


function positiveInteger(
  value,
  message
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    throw createError(
      message
    );
  }

  return number;
}


function normalizeToken(
  value
) {
  const token =
    String(value || "")
      .trim();

  if (
    token.length < 20 ||
    token.length > 200
  ) {
    throw createError(
      "Некорректный токен корзины"
    );
  }

  return token;
}


function hashGuestToken(
  token
) {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}


export function mergeCartQuantity(
  currentQuantity,
  guestQuantity,
  availableQuantity
) {
  const current =
    Math.max(
      0,
      Number(currentQuantity) || 0
    );

  const guest =
    Math.max(
      0,
      Number(guestQuantity) || 0
    );

  const available =
    Math.max(
      0,
      Number(availableQuantity) || 0
    );

  return Math.min(
    current + guest,
    available
  );
}


export function normalizeCartClaimInput({
  userId,
  cartId,
  guestToken,
}) {
  return {
    userId:
      positiveInteger(
        userId,
        "Некорректный пользователь"
      ),

    cartId:
      positiveInteger(
        cartId,
        "Некорректный cartId"
      ),

    guestToken:
      normalizeToken(
        guestToken
      ),
  };
}


function publicCart(
  row
) {
  return {
    id:
      Number(row.id),

    userId:
      row.user_id === null
        ? null
        : Number(row.user_id),

    status:
      row.status,
  };
}


async function loadCartSummary(
  cartId,
  db
) {
  const result =
    await db.query(
      `
        SELECT
          COUNT(*)::integer
            AS items_count,

          COALESCE(
            SUM(quantity),
            0
          )::numeric
            AS total_quantity

        FROM cart_items

        WHERE cart_id = $1;
      `,
      [
        cartId,
      ]
    );

  return {
    itemsCount:
      Number(
        result.rows[0]
          .items_count
      ),

    totalQuantity:
      Number(
        result.rows[0]
          .total_quantity
      ),
  };
}


export const ClientCartService = {
  async claimGuestCart(
    input
  ) {
    const {
      userId,
      cartId,
      guestToken,
    } =
      normalizeCartClaimInput(
        input
      );

    const tokenHash =
      hashGuestToken(
        guestToken
      );

    const db =
      await pool.connect();

    try {
      await db.query(
        "BEGIN"
      );

      const sourceResult =
        await db.query(
          `
            SELECT
              *
            FROM carts
            WHERE id = $1
              AND status = 'ACTIVE'
            FOR UPDATE;
          `,
          [
            cartId,
          ]
        );

      const sourceCart =
        sourceResult.rows[0];

      if (!sourceCart) {
        throw createError(
          "Гостевая корзина не найдена",
          404
        );
      }

      if (
        Number(
          sourceCart.user_id
        ) === userId
      ) {
        const summary =
          await loadCartSummary(
            sourceCart.id,
            db
          );

        await db.query(
          "COMMIT"
        );

        return {
          cart:
            publicCart(
              sourceCart
            ),

          merged:
            false,

          alreadyClaimed:
            true,

          ...summary,
        };
      }

      if (
        sourceCart.user_id !==
          null ||
        sourceCart
          .guest_token_hash !==
          tokenHash
      ) {
        throw createError(
          "Гостевая корзина не найдена или токен недействителен",
          404
        );
      }

      const targetResult =
        await db.query(
          `
            SELECT
              *
            FROM carts
            WHERE user_id = $1
              AND status = 'ACTIVE'
              AND id <> $2
            ORDER BY
              created_at DESC,
              id DESC
            LIMIT 1
            FOR UPDATE;
          `,
          [
            userId,
            cartId,
          ]
        );

      const targetCart =
        targetResult.rows[0];

      if (!targetCart) {
        const claimedResult =
          await db.query(
            `
              UPDATE carts
              SET
                user_id = $2,
                guest_token_hash =
                  NULL,
                updated_at =
                  CURRENT_TIMESTAMP
              WHERE id = $1
              RETURNING *;
            `,
            [
              cartId,
              userId,
            ]
          );

        const claimedCart =
          claimedResult.rows[0];

        const summary =
          await loadCartSummary(
            claimedCart.id,
            db
          );

        await db.query(
          "COMMIT"
        );

        return {
          cart:
            publicCart(
              claimedCart
            ),

          merged:
            false,

          alreadyClaimed:
            false,

          ...summary,
        };
      }

      const itemsResult =
        await db.query(
          `
            SELECT
              source_item
                .product_offer_id,

              source_item.quantity
                AS guest_quantity,

              COALESCE(
                target_item.quantity,
                0
              ) AS current_quantity,

              COALESCE(
                offer.quantity,
                0
              ) AS available_quantity,

              offer.is_available,
              offer.is_hidden

            FROM cart_items
              AS source_item

            JOIN product_offers
              AS offer
              ON
                offer.id =
                  source_item
                    .product_offer_id

            LEFT JOIN cart_items
              AS target_item
              ON
                target_item.cart_id =
                  $2
                AND
                target_item
                  .product_offer_id =
                  source_item
                    .product_offer_id

            WHERE
              source_item.cart_id =
                $1;
          `,
          [
            cartId,
            targetCart.id,
          ]
        );

      let mergedItems = 0;

      for (
        const row
        of itemsResult.rows
      ) {
        if (
          row.is_available !==
            true ||
          row.is_hidden ===
            true
        ) {
          continue;
        }

        const nextQuantity =
          mergeCartQuantity(
            row.current_quantity,
            row.guest_quantity,
            row.available_quantity
          );

        if (
          nextQuantity <= 0
        ) {
          continue;
        }

        await db.query(
          `
            INSERT INTO cart_items (
              cart_id,
              product_offer_id,
              quantity
            )
            VALUES (
              $1,
              $2,
              $3
            )

            ON CONFLICT (
              cart_id,
              product_offer_id
            )
            DO UPDATE SET
              quantity =
                EXCLUDED.quantity,
              updated_at =
                CURRENT_TIMESTAMP;
          `,
          [
            targetCart.id,
            row.product_offer_id,
            nextQuantity,
          ]
        );

        mergedItems++;
      }

      await db.query(
        `
          UPDATE carts
          SET
            status =
              'CHECKED_OUT',
            guest_token_hash =
              NULL,
            updated_at =
              CURRENT_TIMESTAMP
          WHERE id = $1;
        `,
        [
          cartId,
        ]
      );

      const summary =
        await loadCartSummary(
          targetCart.id,
          db
        );

      await db.query(
        "COMMIT"
      );

      return {
        cart:
          publicCart(
            targetCart
          ),

        merged:
          true,

        alreadyClaimed:
          false,

        mergedItems,

        ...summary,
      };

    } catch (error) {
      await db.query(
        "ROLLBACK"
      );

      throw error;

    } finally {
      db.release();
    }
  },
};
