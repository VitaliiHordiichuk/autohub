import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { transaction } from "../src/db/transaction.js";
import { CartRepository } from "../src/repositories/CartRepository.js";
import { OrderRepository } from "../src/repositories/OrderRepository.js";
import { ProductRepository } from "../src/repositories/ProductRepository.js";
import { CartAccessService } from "../src/services/CartAccessService.js";
import { CartService } from "../src/services/CartService.js";
import { CheckoutService } from "../src/services/CheckoutService.js";
import { OrderEditingService } from "../src/services/OrderEditingService.js";
import { SubmitOrder } from "../src/use-cases/checkout/SubmitOrder.js";


const tracked = {
  carts: [],
  orders: [],
  offers: [],
  products: [],
  warehouses: [],
};

function uniqueSuffix() {
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
}

async function createWarehouse() {
  const suffix = uniqueSuffix();
  const result = await pool.query(`
    INSERT INTO warehouses(name, city, type)
    VALUES($1, 'A01 test city', 'OWN')
    RETURNING id;
  `, [`A01 lock warehouse ${suffix}`]);
  const id = Number(result.rows[0].id);
  tracked.warehouses.push(id);
  return id;
}

async function createOffer({
  warehouseId,
  quantity = 2,
  isAvailable = true,
} = {}) {
  const suffix = uniqueSuffix();
  const article = `A01LOCK${suffix}`;
  const productResult = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'A01 row lock fixture', TRUE)
    RETURNING id;
  `, [article]);
  const productId = Number(productResult.rows[0].id);
  tracked.products.push(productId);

  const offerResult = await pool.query(`
    INSERT INTO product_offers(
      product_id,
      warehouse_id,
      quantity,
      purchase_price,
      retail_price,
      minimum_sale_price,
      delivery_days,
      is_available,
      source_type,
      price_mode,
      is_hidden
    )
    VALUES($1, $2, $3, 80, 120, 100, 0, $4, 'OWN_STOCK', 'AUTO', FALSE)
    RETURNING id;
  `, [productId, warehouseId ?? null, quantity, isAvailable]);
  const offerId = Number(offerResult.rows[0].id);
  tracked.offers.push(offerId);

  return { productId, offerId, article };
}

async function createGuestCart(offerEntries) {
  const { cart, guestToken } = await CartAccessService.getOrCreate({ db: pool });
  tracked.carts.push(Number(cart.id));

  const items = [];
  for (const { offerId, quantity = 1 } of offerEntries) {
    items.push(await CartRepository.addItem(cart.id, offerId, quantity, pool));
  }

  return {
    cartId: Number(cart.id),
    guestToken,
    items,
  };
}

async function deleteTracked(table, ids) {
  if (!ids.length) return;
  await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::int[])`, [ids]);
}

after(async () => {
  try {
    if (tracked.orders.length) {
      await pool.query(`
        DELETE FROM order_item_history
        WHERE order_item_id IN (
          SELECT id FROM order_items WHERE order_id = ANY($1::int[])
        );
      `, [tracked.orders]);
      await pool.query(
        "DELETE FROM stock_reservations WHERE order_id = ANY($1::int[])",
        [tracked.orders]
      );
      await pool.query(
        "DELETE FROM order_items WHERE order_id = ANY($1::int[])",
        [tracked.orders]
      );
      await deleteTracked("orders", tracked.orders);
    }

    if (tracked.carts.length) {
      await pool.query(
        "DELETE FROM stock_reservations WHERE cart_id = ANY($1::int[])",
        [tracked.carts]
      );
      await pool.query(
        "DELETE FROM checkout_sessions WHERE cart_id = ANY($1::int[])",
        [tracked.carts]
      );
      await pool.query(
        "DELETE FROM cart_items WHERE cart_id = ANY($1::int[])",
        [tracked.carts]
      );
      await deleteTracked("carts", tracked.carts);
    }

    await deleteTracked("product_offers", tracked.offers);
    await deleteTracked("products", tracked.products);
    await deleteTracked("warehouses", tracked.warehouses);
  } finally {
    await pool.end();
  }
});


test("PostgreSQL locks an offer with a warehouse without SQLSTATE 0A000", async () => {
  const warehouseId = await createWarehouse();
  const { offerId } = await createOffer({ warehouseId });

  const offer = await transaction((db) =>
    ProductRepository.findOfferByIdForUpdate(offerId, db)
  );

  assert.equal(offer.id, offerId);
  assert.equal(offer.warehouseId, warehouseId);
});

test("PostgreSQL locks an offer whose warehouse_id is NULL", async () => {
  const { offerId } = await createOffer({ warehouseId: null });

  const offer = await transaction((db) =>
    ProductRepository.findOfferByIdForUpdate(offerId, db)
  );

  assert.equal(offer.id, offerId);
  assert.equal(offer.warehouseId, null);
});

test("product_offers row lock serializes two PostgreSQL transactions", async () => {
  const warehouseId = await createWarehouse();
  const { offerId } = await createOffer({ warehouseId });
  const first = await pool.connect();
  const second = await pool.connect();

  try {
    await first.query("BEGIN");
    await second.query("BEGIN");
    await ProductRepository.findOfferByIdForUpdate(offerId, first);

    let secondFinished = false;
    const secondLock = ProductRepository.findOfferByIdForUpdate(offerId, second)
      .then((offer) => {
        secondFinished = true;
        return offer;
      });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(secondFinished, false);

    await first.query("COMMIT");
    const lockedOffer = await secondLock;
    assert.equal(lockedOffer.id, offerId);
    await second.query("ROLLBACK");
  } finally {
    if (!first.released) {
      await first.query("ROLLBACK").catch(() => {});
      first.release();
    }
    if (!second.released) {
      await second.query("ROLLBACK").catch(() => {});
      second.release();
    }
  }
});

test("ordinary checkout passes lockAndValidateItems for an available offer", async () => {
  const warehouseId = await createWarehouse();
  const { offerId } = await createOffer({ warehouseId, quantity: 2 });
  const cart = await createGuestCart([{ offerId }]);

  const result = await CheckoutService.start({
    cartId: cart.cartId,
    itemIds: [Number(cart.items[0].id)],
    guestToken: cart.guestToken,
  });

  assert.equal(result.checkoutSession.status, "ACTIVE");
  assert.equal(result.reservations.length, 1);
  assert.equal(Number(result.reservations[0].product_offer_id), offerId);
  assert.equal(Number(result.reservations[0].quantity), 1);
});

test("two concurrent checkouts cannot both reserve the only unit", async () => {
  const warehouseId = await createWarehouse();
  const { offerId } = await createOffer({ warehouseId, quantity: 1 });
  const firstCart = await createGuestCart([{ offerId }]);
  const secondCart = await createGuestCart([{ offerId }]);

  const results = await Promise.allSettled([
    CheckoutService.start({
      cartId: firstCart.cartId,
      guestToken: firstCart.guestToken,
    }),
    CheckoutService.start({
      cartId: secondCart.cartId,
      guestToken: secondCart.guestToken,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match(
    results.find((result) => result.status === "rejected").reason.message,
    /Недостатньо товару/
  );

  const reservations = await pool.query(`
    SELECT COUNT(*)::integer AS count, COALESCE(SUM(quantity), 0)::numeric AS quantity
    FROM stock_reservations
    WHERE product_offer_id = $1
      AND status = 'ACTIVE'
      AND reserved_until > CURRENT_TIMESTAMP;
  `, [offerId]);

  assert.equal(reservations.rows[0].count, 1);
  assert.equal(Number(reservations.rows[0].quantity), 1);
});

test("failure on the second checkout item rolls back the existing session changes", async () => {
  const warehouseId = await createWarehouse();
  const available = await createOffer({ warehouseId, quantity: 2 });
  const unavailable = await createOffer({ warehouseId, quantity: 0, isAvailable: false });
  assert.ok(available.offerId < unavailable.offerId);
  const cart = await createGuestCart([
    { offerId: available.offerId },
    { offerId: unavailable.offerId },
  ]);

  const initial = await CheckoutService.start({
    cartId: cart.cartId,
    itemIds: [Number(cart.items[0].id)],
    guestToken: cart.guestToken,
  });

  await assert.rejects(
    CheckoutService.start({
      cartId: cart.cartId,
      itemIds: cart.items.map((item) => Number(item.id)),
      guestToken: cart.guestToken,
    }),
    /зараз недоступний/
  );

  const session = await pool.query(
    "SELECT status FROM checkout_sessions WHERE id = $1",
    [initial.checkoutSession.id]
  );
  const reservation = await pool.query(
    "SELECT status, quantity FROM stock_reservations WHERE id = $1",
    [initial.reservations[0].id]
  );

  assert.equal(session.rows[0].status, "ACTIVE");
  assert.equal(reservation.rows[0].status, "ACTIVE");
  assert.equal(Number(reservation.rows[0].quantity), 1);
});

test("cart quantity change invalidates old checkout and recreates reservation with the new quantity", async () => {
  const warehouseId = await createWarehouse();
  const { offerId } = await createOffer({
    warehouseId,
    quantity: 2,
  });

  const cart = await createGuestCart([
    {
      offerId,
      quantity: 1,
    },
  ]);

  const cartItemId =
    Number(cart.items[0].id);

  const initial =
    await CheckoutService.start({
      cartId: cart.cartId,
      guestToken: cart.guestToken,
    });

  assert.equal(
    Number(initial.reservations[0].quantity),
    1
  );

  const updatedCart =
    await CartService.updateItemQuantity({
      cartId: cart.cartId,
      itemId: cartItemId,
      guestToken: cart.guestToken,
      quantity: 2,
    });

  assert.equal(
    Number(updatedCart.items[0].quantity),
    2
  );

  const oldSession = await pool.query(
    `
      SELECT status
      FROM checkout_sessions
      WHERE id = $1;
    `,
    [initial.checkoutSession.id]
  );

  const oldReservation = await pool.query(
    `
      SELECT status, quantity
      FROM stock_reservations
      WHERE id = $1;
    `,
    [initial.reservations[0].id]
  );

  assert.equal(
    oldSession.rows[0].status,
    "CANCELLED"
  );

  assert.equal(
    oldReservation.rows[0].status,
    "RELEASED"
  );

  assert.equal(
    Number(oldReservation.rows[0].quantity),
    1
  );

  await assert.rejects(
    SubmitOrder.execute({
      checkoutId:
        initial.checkoutSession.id,
      guestToken:
        cart.guestToken,
    }),
    /Сесію оформлення не знайдено або строк резерву минув/
  );

  const restarted =
    await CheckoutService.start({
      cartId: cart.cartId,
      guestToken: cart.guestToken,
    });

  assert.equal(
    restarted.checkoutSession.status,
    "ACTIVE"
  );

  assert.equal(
    restarted.reservations.length,
    1
  );

  assert.equal(
    Number(
      restarted.reservations[0]
        .product_offer_id
    ),
    offerId
  );

  assert.equal(
    Number(
      restarted.reservations[0]
        .quantity
    ),
    2
  );

  const activeReservations =
    await pool.query(
      `
        SELECT
          COUNT(*)::integer AS count,
          COALESCE(SUM(quantity), 0)::numeric AS quantity
        FROM stock_reservations
        WHERE cart_id = $1
          AND status = 'ACTIVE'
          AND reserved_until > CURRENT_TIMESTAMP;
      `,
      [cart.cartId]
    );

  assert.equal(
    activeReservations.rows[0].count,
    1
  );

  assert.equal(
    Number(
      activeReservations.rows[0]
        .quantity
    ),
    2
  );
});

test("OrderEditingService addItem and changeQuantity use the scoped offer lock", async () => {
  const warehouseId = await createWarehouse();
  const { productId, offerId } = await createOffer({ warehouseId, quantity: 5 });
  const order = await OrderRepository.createOrder({ comment: "A01 order editing fixture" });
  tracked.orders.push(Number(order.id));

  const added = await OrderEditingService.addItem({
    orderId: order.id,
    productId,
    productOfferId: offerId,
    quantity: 1,
    reason: "A01 addItem regression",
  });
  assert.equal(Number(added.item.quantity), 1);

  const changed = await OrderEditingService.changeQuantity({
    orderId: order.id,
    orderItemId: added.item.id,
    quantity: 2,
    reason: "A01 changeQuantity regression",
  });
  assert.equal(Number(changed.item.quantity), 2);

  const reservation = await pool.query(`
    SELECT quantity, status
    FROM stock_reservations
    WHERE order_id = $1 AND product_offer_id = $2;
  `, [order.id, offerId]);
  assert.equal(reservation.rows.length, 1);
  assert.equal(reservation.rows[0].status, "ORDER_PENDING");
  assert.equal(Number(reservation.rows[0].quantity), 2);
});
