import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { CartRepository } from "../src/repositories/CartRepository.js";
import { ProductRepository } from "../src/repositories/ProductRepository.js";
import { CartAccessService } from "../src/services/CartAccessService.js";
import { CartService } from "../src/services/CartService.js";
import { CheckoutService } from "../src/services/CheckoutService.js";
import { OrderCancellationService } from "../src/services/OrderCancellationService.js";
import { OrderCompletionService } from "../src/services/OrderCompletionService.js";
import { OrderConfirmationService } from "../src/services/OrderConfirmationService.js";
import { OrderEditingService } from "../src/services/OrderEditingService.js";
import { canonicalOfferClassification } from "../src/services/InventoryClassificationService.js";
import { SubmitOrder } from "../src/use-cases/checkout/SubmitOrder.js";

const previousFlag = process.env.CHECKOUT_COMMIT_ON_SUBMIT_ENABLED;
process.env.CHECKOUT_COMMIT_ON_SUBMIT_ENABLED = "true";

const tracked = {
  carts: [],
  orders: [],
  offers: [],
  products: [],
  warehouses: [],
  suppliers: [],
  customers: [],
  users: [],
};

function suffix() {
  return `${process.pid}${Date.now()}${Math.random().toString(16).slice(2, 9)}`;
}

const delivery = {
  recipientFirstName: "Тест",
  recipientLastName: "Покупець",
  recipientPhone: "+380501234567",
  deliveryMethod: "PICKUP",
  pickupWarehouseId: null,
};

async function fixtureOffer({
  quantity = 1,
  price = 120,
  sourceType = "OWN_STOCK",
  supplierType = null,
} = {}) {
  const token = suffix();
  let supplierId = null;
  if (supplierType) {
    const supplier = await pool.query(`
      INSERT INTO suppliers(name, type, is_active)
      VALUES($1,$2,TRUE) RETURNING id;
    `, [`Commit supplier ${token}`, supplierType]);
    supplierId = Number(supplier.rows[0].id);
    tracked.suppliers.push(supplierId);
  }

  const warehouseType = supplierType === "PARTNER" ? "SUPPLIER" : "OWN";
  const warehouse = await pool.query(`
    INSERT INTO warehouses(name, city, type, supplier_id)
    VALUES($1,'Test city',$2,$3) RETURNING id;
  `, [
    `Commit warehouse ${token}`,
    warehouseType,
    supplierType === "PARTNER" ? supplierId : null,
  ]);
  const warehouseId = Number(warehouse.rows[0].id);
  tracked.warehouses.push(warehouseId);

  const product = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1,$1,$2,TRUE) RETURNING id;
  `, [`COMMIT${token}`, `Commit product ${token}`]);
  const productId = Number(product.rows[0].id);
  tracked.products.push(productId);

  const offer = await pool.query(`
    INSERT INTO product_offers(
      product_id, warehouse_id, supplier_id, quantity, purchase_price,
      retail_price, minimum_sale_price, delivery_days, is_available,
      source_type, price_mode, is_hidden
    ) VALUES($1,$2,$3,$4,80,$5,100,0,TRUE,$6,'AUTO',FALSE)
    RETURNING id;
  `, [productId, warehouseId, supplierId, quantity, price, sourceType]);
  const offerId = Number(offer.rows[0].id);
  tracked.offers.push(offerId);
  return { productId, offerId, warehouseId, supplierId, article: `COMMIT${token}` };
}

async function guestCart(entries) {
  const { cart, guestToken } = await CartAccessService.getOrCreate({ db: pool });
  tracked.carts.push(Number(cart.id));
  const items = [];
  for (const entry of entries) {
    items.push(await CartRepository.addItem(
      cart.id, entry.offerId, entry.quantity || 1, pool
    ));
  }
  return { cartId: Number(cart.id), guestToken, items };
}

async function accountCart(entries) {
  const token = suffix();
  const userResult = await pool.query(`
    INSERT INTO users(first_name,last_name,email,password_hash,is_active)
    VALUES('Account','Checkout',$1,'test-only-hash',TRUE)
    RETURNING id;
  `, [`checkout-${token}@example.test`]);
  const userId = Number(userResult.rows[0].id);
  tracked.users.push(userId);
  const customerResult = await pool.query(`
    INSERT INTO customers(user_id,company_name,customer_type,is_active)
    VALUES($1,$2,'RETAIL',TRUE) RETURNING id;
  `, [userId, `Checkout customer ${token}`]);
  tracked.customers.push(Number(customerResult.rows[0].id));
  const { cart } = await CartAccessService.getOrCreate({ userId, db: pool });
  tracked.carts.push(Number(cart.id));
  const items = [];
  for (const entry of entries) {
    items.push(await CartRepository.addItem(cart.id, entry.offerId, entry.quantity || 1, pool));
  }
  return { cartId: Number(cart.id), userId, items };
}

async function start(cart) {
  return CheckoutService.start({
    cartId: cart.cartId,
    guestToken: cart.guestToken,
  });
}

async function submit(cart, checkoutId, key, acceptedPrices = []) {
  const result = await SubmitOrder.execute({
    checkoutId,
    idempotencyKey: key,
    acceptedPrices,
    guestToken: cart.guestToken,
    delivery,
  });
  for (const order of result.orders || [result.order]) {
    if (order && !tracked.orders.includes(Number(order.id))) {
      tracked.orders.push(Number(order.id));
    }
  }
  return result;
}

async function offerQuantity(offerId) {
  const result = await pool.query(
    "SELECT quantity FROM product_offers WHERE id=$1", [offerId]
  );
  return Number(result.rows[0].quantity);
}

after(async () => {
  if (previousFlag === undefined) delete process.env.CHECKOUT_COMMIT_ON_SUBMIT_ENABLED;
  else process.env.CHECKOUT_COMMIT_ON_SUBMIT_ENABLED = previousFlag;
  try {
    if (tracked.orders.length) {
      await pool.query("DELETE FROM user_notifications WHERE order_id=ANY($1::int[])", [tracked.orders]);
      await pool.query("DELETE FROM order_item_history WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=ANY($1::int[]))", [tracked.orders]);
      await pool.query("DELETE FROM order_status_history WHERE order_id=ANY($1::int[])", [tracked.orders]);
      await pool.query("DELETE FROM stock_movements WHERE order_id=ANY($1::int[])", [tracked.orders]);
      await pool.query("DELETE FROM stock_reservations WHERE order_id=ANY($1::int[])", [tracked.orders]);
      await pool.query("DELETE FROM order_delivery_details WHERE order_id=ANY($1::int[])", [tracked.orders]);
      await pool.query("DELETE FROM checkout_session_orders WHERE order_id=ANY($1::int[])", [tracked.orders]);
      await pool.query("DELETE FROM order_items WHERE order_id=ANY($1::int[])", [tracked.orders]);
      await pool.query("DELETE FROM orders WHERE id=ANY($1::int[])", [tracked.orders]);
    }
    if (tracked.carts.length) {
      await pool.query("DELETE FROM stock_reservations WHERE cart_id=ANY($1::int[])", [tracked.carts]);
      await pool.query("DELETE FROM checkout_sessions WHERE cart_id=ANY($1::int[])", [tracked.carts]);
      await pool.query("DELETE FROM cart_items WHERE cart_id=ANY($1::int[])", [tracked.carts]);
      await pool.query("DELETE FROM carts WHERE id=ANY($1::int[])", [tracked.carts]);
    }
    if (tracked.offers.length) await pool.query("DELETE FROM product_offers WHERE id=ANY($1::int[])", [tracked.offers]);
    if (tracked.products.length) await pool.query("DELETE FROM products WHERE id=ANY($1::int[])", [tracked.products]);
    if (tracked.warehouses.length) await pool.query("DELETE FROM warehouses WHERE id=ANY($1::int[])", [tracked.warehouses]);
    if (tracked.suppliers.length) await pool.query("DELETE FROM suppliers WHERE id=ANY($1::int[])", [tracked.suppliers]);
    if (tracked.customers.length) await pool.query("DELETE FROM customers WHERE id=ANY($1::int[])", [tracked.customers]);
    if (tracked.users.length) await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [tracked.users]);
  } finally {
    await pool.end();
  }
});

test("B66961525-style OWN supplier overrides stale SUPPLIER source everywhere", async () => {
  const classification = canonicalOfferClassification({
    supplier_type: "OWN",
    warehouse_type: "OWN",
    source_type: "SUPPLIER",
  });
  assert.deepEqual(classification, {
    fulfillmentType: "STOCK",
    sourceType: "OWN_STOCK",
  });

  const offer = await fixtureOffer({ sourceType: "SUPPLIER", supplierType: "OWN" });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const presented = await CartService.getCart({
    cartId: cart.cartId,
    guestToken: cart.guestToken,
  });
  assert.equal(presented.items[0].sourceType, "OWN_STOCK");
  assert.equal(presented.items[0].fulfillmentType, "STOCK");
  assert.equal(presented.items[0].availabilityStatus, "AVAILABLE");
});

test("cart and checkout intent never reserve or change physical stock", async () => {
  const offer = await fixtureOffer({ quantity: 2 });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  assert.equal(checkout.checkoutSession.inventory_model, "COMMIT_ON_SUBMIT");
  assert.equal(checkout.reservations.length, 0);
  assert.equal(await offerQuantity(offer.offerId), 2);
  const reservations = await pool.query(
    "SELECT count(*)::int AS count FROM stock_reservations WHERE cart_id=$1", [cart.cartId]
  );
  assert.equal(reservations.rows[0].count, 0);
  const intent = await pool.query(
    "SELECT count(*)::int AS count FROM checkout_session_items WHERE checkout_session_id=$1",
    [checkout.checkoutSession.id]
  );
  assert.equal(intent.rows[0].count, 1);
});

test("authenticated carts use the same non-reserving checkout model", async () => {
  const offer = await fixtureOffer({ quantity: 2 });
  const cart = await accountCart([{ offerId: offer.offerId }]);
  const checkout = await CheckoutService.start({
    cartId: cart.cartId,
    userId: cart.userId,
  });
  assert.equal(checkout.checkoutSession.inventory_model, "COMMIT_ON_SUBMIT");
  assert.equal(checkout.reservations.length, 0);
  const result = await SubmitOrder.execute({
    checkoutId: checkout.checkoutSession.id,
    idempotencyKey: `account-${suffix()}`,
    userId: cart.userId,
    delivery,
  });
  tracked.orders.push(...result.orders.map((order) => Number(order.id)));
  assert.equal(result.orders.length, 1);
  assert.equal(await offerQuantity(offer.offerId), 1);
});

test("two concurrent buyers of the last unit create exactly one committed order", async () => {
  const offer = await fixtureOffer({ quantity: 1 });
  const firstCart = await guestCart([{ offerId: offer.offerId }]);
  const secondCart = await guestCart([{ offerId: offer.offerId }]);
  const [firstCheckout, secondCheckout] = await Promise.all([start(firstCart), start(secondCart)]);
  assert.equal(await offerQuantity(offer.offerId), 1);

  const results = await Promise.allSettled([
    submit(firstCart, firstCheckout.checkoutSession.id, `buyer-a-${suffix()}`),
    submit(secondCart, secondCheckout.checkoutSession.id, `buyer-b-${suffix()}`),
  ]);
  const fulfilled = results.filter((entry) => entry.status === "fulfilled");
  const rejected = results.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "STOCK_CHANGED");
  assert.equal(rejected[0].reason.details.atomicRollback, true);
  assert.equal(await offerQuantity(offer.offerId), 0);
  const orders = await pool.query(
    "SELECT count(*)::int AS count FROM orders WHERE checkout_session_id=ANY($1::int[])",
    [[firstCheckout.checkoutSession.id, secondCheckout.checkoutSession.id]]
  );
  assert.equal(orders.rows[0].count, 1);
});

test("idempotent replay returns the original order and never decrements twice", async () => {
  const offer = await fixtureOffer({ quantity: 2 });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const key = `repeat-${suffix()}`;
  const first = await submit(cart, checkout.checkoutSession.id, key);
  const second = await submit(cart, checkout.checkoutSession.id, key);
  assert.equal(second.idempotentReplay, true);
  assert.deepEqual(second.orders.map((order) => Number(order.id)), first.orders.map((order) => Number(order.id)));
  assert.equal(await offerQuantity(offer.offerId), 1);
  const movements = await pool.query(
    "SELECT count(*)::int AS count FROM stock_movements WHERE order_id=$1 AND type='ORDER_COMMIT'",
    [first.order.id]
  );
  assert.equal(movements.rows[0].count, 1);
});

test("price changes require explicit confirmation before any order exists", async () => {
  const offer = await fixtureOffer({ quantity: 1, price: 120 });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  await pool.query("UPDATE product_offers SET retail_price=135 WHERE id=$1", [offer.offerId]);
  const key = `price-${suffix()}`;
  await assert.rejects(
    submit(cart, checkout.checkoutSession.id, key),
    (error) => error.code === "PRICE_CHANGED" && error.details.issues[0].newPrice === 135
  );
  const before = await pool.query(
    "SELECT count(*)::int AS count FROM orders WHERE checkout_session_id=$1",
    [checkout.checkoutSession.id]
  );
  assert.equal(before.rows[0].count, 0);
  assert.equal(await offerQuantity(offer.offerId), 1);
  const completed = await submit(cart, checkout.checkoutSession.id, key, [
    { productOfferId: offer.offerId, price: 135 },
  ]);
  assert.equal(completed.orders.length, 1);
  assert.equal(await offerQuantity(offer.offerId), 0);
});

test("mixed cart creates two orders atomically and rolls both back on a supplier conflict", async () => {
  const stock = await fixtureOffer({ quantity: 2 });
  const supplier = await fixtureOffer({ quantity: 3, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const cart = await guestCart([{ offerId: stock.offerId }, { offerId: supplier.offerId }]);
  const checkout = await start(cart);
  await pool.query("UPDATE product_offers SET quantity=0,is_available=FALSE WHERE id=$1", [supplier.offerId]);
  await assert.rejects(
    submit(cart, checkout.checkoutSession.id, `mixed-fail-${suffix()}`),
    (error) => error.code === "MIXED_CHECKOUT_FAILED" && error.details.atomicRollback === true
  );
  assert.equal(await offerQuantity(stock.offerId), 2);
  let count = await pool.query(
    "SELECT count(*)::int AS count FROM orders WHERE checkout_session_id=$1",
    [checkout.checkoutSession.id]
  );
  assert.equal(count.rows[0].count, 0);

  await pool.query("UPDATE product_offers SET quantity=3,is_available=TRUE WHERE id=$1", [supplier.offerId]);
  const mixedKey = `mixed-ok-${suffix()}`;
  const success = await submit(cart, checkout.checkoutSession.id, mixedKey);
  assert.equal(success.orders.length, 2);
  assert.deepEqual(
    new Set(success.orders.map((order) => order.fulfillment_type)),
    new Set(["STOCK", "SUPPLIER_ORDER"])
  );
  assert.equal(await offerQuantity(stock.offerId), 1);
  assert.equal(await offerQuantity(supplier.offerId), 3);
  const replay = await submit(cart, checkout.checkoutSession.id, mixedKey);
  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual(
    replay.orders.map((order) => Number(order.id)),
    success.orders.map((order) => Number(order.id))
  );
  assert.equal(await offerQuantity(stock.offerId), 1);
  count = await pool.query(
    "SELECT count(*)::int AS count FROM orders WHERE checkout_session_id=$1",
    [checkout.checkoutSession.id]
  );
  assert.equal(count.rows[0].count, 2);
});

test("new order editing, cancellation and completion adjust stock exactly once", async () => {
  const offer = await fixtureOffer({ quantity: 3 });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const result = await submit(cart, checkout.checkoutSession.id, `lifecycle-${suffix()}`);
  const orderId = Number(result.order.id);
  const itemId = Number(result.orderItems[0].id);
  assert.equal(await offerQuantity(offer.offerId), 2);

  await OrderEditingService.changeQuantity({ orderId, orderItemId: itemId, quantity: 2 });
  assert.equal(await offerQuantity(offer.offerId), 1);
  await OrderEditingService.changeQuantity({ orderId, orderItemId: itemId, quantity: 1 });
  assert.equal(await offerQuantity(offer.offerId), 2);
  await OrderEditingService.removeItem({ orderId, orderItemId: itemId });
  assert.equal(await offerQuantity(offer.offerId), 3);
  await OrderEditingService.restoreItem({ orderId, orderItemId: itemId });
  assert.equal(await offerQuantity(offer.offerId), 2);

  const addedOffer = await fixtureOffer({ quantity: 2 });
  const added = await OrderEditingService.addItem({
    orderId,
    productId: addedOffer.productId,
    productOfferId: addedOffer.offerId,
    quantity: 1,
  });
  assert.equal(Number(added.item.inventory_committed_quantity), 1);
  assert.equal(await offerQuantity(addedOffer.offerId), 1);
  await OrderEditingService.removeItem({ orderId, orderItemId: added.item.id });
  assert.equal(await offerQuantity(addedOffer.offerId), 2);
  await OrderEditingService.restoreItem({ orderId, orderItemId: added.item.id });
  assert.equal(await offerQuantity(addedOffer.offerId), 1);
  await OrderConfirmationService.confirmOrder({ orderId });
  await OrderCompletionService.completeOrder({ orderId });
  assert.equal(await offerQuantity(offer.offerId), 2);
  assert.equal(await offerQuantity(addedOffer.offerId), 1);

  const cancellableOffer = await fixtureOffer({ quantity: 1 });
  const cancellableCart = await guestCart([{ offerId: cancellableOffer.offerId }]);
  const cancellableCheckout = await start(cancellableCart);
  const cancellable = await submit(
    cancellableCart, cancellableCheckout.checkoutSession.id, `cancel-${suffix()}`
  );
  await OrderCancellationService.cancelOrder({ orderId: cancellable.order.id });
  assert.equal(await offerQuantity(cancellableOffer.offerId), 1);
  await assert.rejects(
    OrderCancellationService.cancelOrder({ orderId: cancellable.order.id }),
    /отменить нельзя/
  );
  assert.equal(await offerQuantity(cancellableOffer.offerId), 1);
});

test("repeating an own-stock import preserves sales while a real receipt increases stock", async () => {
  const offer = await fixtureOffer({ quantity: 1 });
  await pool.query(
    "UPDATE product_offers SET last_import_quantity=1,last_import_at=CURRENT_TIMESTAMP WHERE id=$1",
    [offer.offerId]
  );
  await ProductRepository.decreaseQuantityForSale(offer.offerId, 1, pool);
  await ProductRepository.updateOfferStockFromImport(offer.offerId, {
    importedQuantity: 1,
    purchasePrice: 80,
    retailPrice: 120,
    minimumSalePrice: 100,
    preserveCommittedSales: true,
  }, pool);
  assert.equal(await offerQuantity(offer.offerId), 0);
  await ProductRepository.updateOfferStockFromImport(offer.offerId, {
    importedQuantity: 2,
    purchasePrice: 80,
    retailPrice: 120,
    minimumSalePrice: 100,
    preserveCommittedSales: true,
  }, pool);
  assert.equal(await offerQuantity(offer.offerId), 1);
});
