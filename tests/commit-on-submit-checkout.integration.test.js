import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { CartRepository } from "../src/repositories/CartRepository.js";
import { CheckoutRepository } from "../src/repositories/CheckoutRepository.js";
import { OrderRepository } from "../src/repositories/OrderRepository.js";
import { ProductRepository } from "../src/repositories/ProductRepository.js";
import { ReservationRepository } from "../src/repositories/ReservationRepository.js";
import { CartAccessService } from "../src/services/CartAccessService.js";
import { CartService } from "../src/services/CartService.js";
import { CheckoutService } from "../src/services/CheckoutService.js";
import { OrderCancellationService } from "../src/services/OrderCancellationService.js";
import { OrderCompletionService } from "../src/services/OrderCompletionService.js";
import { OrderConfirmationService } from "../src/services/OrderConfirmationService.js";
import { OrderEditingService } from "../src/services/OrderEditingService.js";
import { OfferService } from "../src/services/OfferService.js";
import { ImportService } from "../src/services/ImportService.js";
import { WarehouseImportProfileService } from "../src/services/WarehouseImportProfileService.js";
import { canonicalOfferClassification } from "../src/services/InventoryClassificationService.js";
import { SubmitOrder } from "../src/use-cases/checkout/SubmitOrder.js";

const tracked = {
  carts: [],
  orders: [],
  offers: [],
  products: [],
  warehouses: [],
  suppliers: [],
  customers: [],
  users: [],
  brands: [],
  warehouseSupplierImports: [],
  supplierImportSettings: [],
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

async function importSupplierQuantity(offerId, quantity) {
  await ProductRepository.updateOfferStockFromImport(offerId, {
    importedQuantity: quantity,
    purchasePrice: 80,
    retailPrice: 120,
    minimumSalePrice: 100,
    preserveCommittedSales: false,
    sourceType: "SUPPLIER",
  }, pool);
}

after(async () => {
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
    if (tracked.warehouses.length) {
      await pool.query("DELETE FROM imports WHERE warehouse_id=ANY($1::int[])", [tracked.warehouses]);
    }
    if (tracked.offers.length) await pool.query("DELETE FROM product_offers WHERE id=ANY($1::int[])", [tracked.offers]);
    if (tracked.products.length) await pool.query("DELETE FROM products WHERE id=ANY($1::int[])", [tracked.products]);
    if (tracked.warehouseSupplierImports.length) {
      await pool.query("DELETE FROM warehouse_supplier_imports WHERE id=ANY($1::int[])", [tracked.warehouseSupplierImports]);
    }
    if (tracked.supplierImportSettings.length) {
      await pool.query("DELETE FROM supplier_import_settings WHERE id=ANY($1::int[])", [tracked.supplierImportSettings]);
    }
    if (tracked.warehouses.length) await pool.query("DELETE FROM warehouses WHERE id=ANY($1::int[])", [tracked.warehouses]);
    if (tracked.suppliers.length) await pool.query("DELETE FROM suppliers WHERE id=ANY($1::int[])", [tracked.suppliers]);
    if (tracked.customers.length) await pool.query("DELETE FROM customers WHERE id=ANY($1::int[])", [tracked.customers]);
    if (tracked.users.length) await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [tracked.users]);
    if (tracked.brands.length) await pool.query("DELETE FROM brands WHERE id=ANY($1::int[])", [tracked.brands]);
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

test("opening a new checkout releases an old five-minute cart hold", async () => {
  const offer = await fixtureOffer({ quantity: 1 });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const legacy = await CheckoutRepository.createSession({
    cartId: cart.cartId,
    expiresAt: new Date(Date.now() + 300_000),
    inventoryModel: "LEGACY_RESERVATION",
  });
  const hold = await pool.query(`
    INSERT INTO stock_reservations (
      cart_id, cart_item_id, checkout_session_id, product_offer_id,
      quantity, status, reserved_until
    ) VALUES ($1,$2,$3,$4,1,'ACTIVE',CURRENT_TIMESTAMP + INTERVAL '5 minutes')
    RETURNING id
  `, [cart.cartId, cart.items[0].id, legacy.id, offer.offerId]);
  const current = await start(cart);
  assert.equal(current.checkoutSession.inventory_model, "COMMIT_ON_SUBMIT");
  assert.equal(current.reservations.length, 0);
  const old = await pool.query(
    "SELECT status FROM checkout_sessions WHERE id=$1", [legacy.id]
  );
  const oldHold = await pool.query(
    "SELECT status FROM stock_reservations WHERE id=$1", [hold.rows[0].id]
  );
  assert.equal(old.rows[0].status, "CANCELLED");
  assert.equal(oldHold.rows[0].status, "RELEASED");
  assert.equal(await offerQuantity(offer.offerId), 1);
});

test("an already-open legacy checkout can still submit its existing hold", async () => {
  const offer = await fixtureOffer({ quantity: 1 });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const legacy = await CheckoutRepository.createSession({
    cartId: cart.cartId,
    expiresAt: new Date(Date.now() + 300_000),
    inventoryModel: "LEGACY_RESERVATION",
  });
  await pool.query(`
    INSERT INTO stock_reservations (
      cart_id, cart_item_id, checkout_session_id, product_offer_id,
      quantity, status, reserved_until
    ) VALUES ($1,$2,$3,$4,1,'ACTIVE',CURRENT_TIMESTAMP + INTERVAL '5 minutes')
  `, [cart.cartId, cart.items[0].id, legacy.id, offer.offerId]);
  const submitted = await submit(cart, legacy.id, `old-session-${suffix()}`);
  assert.equal(submitted.order.inventory_model, "LEGACY_RESERVATION");
  assert.equal(await offerQuantity(offer.offerId), 1);
  const linked = await pool.query(
    "SELECT status FROM stock_reservations WHERE order_id=$1", [submitted.order.id]
  );
  assert.equal(linked.rows[0].status, "ORDER_PENDING");
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

test("two concurrent supplier checkouts cannot sell the same last imported unit", async () => {
  const offer = await fixtureOffer({ quantity: 1, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const firstCart = await guestCart([{ offerId: offer.offerId }]);
  const secondCart = await guestCart([{ offerId: offer.offerId }]);
  const [firstCheckout, secondCheckout] = await Promise.all([start(firstCart), start(secondCart)]);
  const results = await Promise.allSettled([
    submit(firstCart, firstCheckout.checkoutSession.id, `supplier-a-${suffix()}`),
    submit(secondCart, secondCheckout.checkoutSession.id, `supplier-b-${suffix()}`),
  ]);
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  const failure = results.find((entry) => entry.status === "rejected")?.reason;
  assert.equal(failure?.code, "SUPPLIER_UNAVAILABLE");
  assert.equal(await offerQuantity(offer.offerId), 1);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  const [publicOffer] = await OfferService.getOffersByProductId(offer.productId, null, "uk");
  assert.equal(publicOffer.quantity, 0);
  assert.equal(publicOffer.availabilityStatus, "UNAVAILABLE");
});

test("supplier cancellation restores saleability once without inflating imported stock", async () => {
  const offer = await fixtureOffer({ quantity: 1, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const order = await submit(cart, checkout.checkoutSession.id, `supplier-cancel-${suffix()}`);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await OrderCancellationService.cancelOrder({ orderId: order.order.id });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 0);
  assert.equal(await offerQuantity(offer.offerId), 1);
  await assert.rejects(
    OrderCancellationService.cancelOrder({ orderId: order.order.id }),
    /отменить нельзя/
  );
  assert.equal(await offerQuantity(offer.offerId), 1);
});

test("repeated supplier imports keep an unfinished sale unavailable until cancellation", async () => {
  const offer = await fixtureOffer({ quantity: 1, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const order = await submit(cart, checkout.checkoutSession.id, `supplier-import-${suffix()}`);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await importSupplierQuantity(offer.offerId, 1);
  await importSupplierQuantity(offer.offerId, 1);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  assert.equal(await offerQuantity(offer.offerId), 1);
  const [unavailable] = await OfferService.getOffersByProductId(offer.productId, null, "uk");
  assert.equal(unavailable.quantity, 0);
  assert.equal(unavailable.availabilityStatus, "UNAVAILABLE");

  const secondCart = await guestCart([{ offerId: offer.offerId }]);
  const secondCheckout = await start(secondCart);
  await assert.rejects(
    submit(secondCart, secondCheckout.checkoutSession.id, `supplier-second-${suffix()}`),
    (error) => error.code === "SUPPLIER_UNAVAILABLE"
  );

  await OrderCancellationService.cancelOrder({ orderId: order.order.id });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 0);
  assert.equal(await offerQuantity(offer.offerId), 1);
  const [available] = await OfferService.getOffersByProductId(offer.productId, null, "uk");
  assert.equal(available.quantity, 1);
  assert.equal(available.availabilityStatus, "ON_ORDER");
  const nextCheckout = await start(secondCart);
  await submit(secondCart, nextCheckout.checkoutSession.id, `supplier-after-cancel-${suffix()}`);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  assert.equal(await offerQuantity(offer.offerId), 1);
});

test("a full supplier price import cannot resell a unit from an unfinished order", async () => {
  const brand = await pool.query(
    "INSERT INTO brands(name,is_active) VALUES($1,TRUE) RETURNING id",
    [`Commit import brand ${suffix()}`]
  );
  const brandId = Number(brand.rows[0].id);
  tracked.brands.push(brandId);
  const offer = await fixtureOffer({ quantity: 1, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const article = offer.article.toUpperCase();
  await pool.query(
    "UPDATE products SET brand_id=$2,article=$3,article_normalized=$3 WHERE id=$1",
    [offer.productId, brandId, article]
  );
  const { profile } = await WarehouseImportProfileService.saveProfile(offer.warehouseId, {
    fileType: "CSV",
    brandMode: "FIXED",
    fixedBrandId: brandId,
    articleColumn: 1,
    nameColumn: 2,
    priceColumn: 3,
    quantityColumn: 4,
    startRow: 1,
    isActive: true,
    emailAutoImportEnabled: false,
    newProductsMode: "AUTO",
  });
  tracked.warehouseSupplierImports.push(Number(profile.id));
  tracked.supplierImportSettings.push(Number(profile.supplierImportSettingsId));
  const context = {
    warehouseId: offer.warehouseId,
    warehouseSupplierImportId: Number(profile.id),
    fileName: "supplier-stock-one.csv",
    fileType: "CSV",
    importMethod: "MANUAL",
  };
  const row = { article, name: `Commit product ${article}`, price: 80, quantity: 1 };
  const firstImport = await ImportService.importRows(context, [row]);
  assert.equal(firstImport.successRows, 1);
  assert.equal(firstImport.replacementApplied, true);

  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const order = await submit(cart, checkout.checkoutSession.id, `full-import-${suffix()}`);
  const secondImport = await ImportService.importRows(context, [row]);
  assert.equal(secondImport.successRows, 1);
  assert.equal(secondImport.replacementApplied, true);
  assert.equal(await offerQuantity(offer.offerId), 1);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  const [soldOut] = await OfferService.getOffersByProductId(offer.productId, null, "uk");
  assert.equal(soldOut.quantity, 0);

  await OrderCancellationService.cancelOrder({ orderId: order.order.id });
  assert.equal(await offerQuantity(offer.offerId), 1);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 0);
  const [available] = await OfferService.getOffersByProductId(offer.productId, null, "uk");
  assert.equal(available.quantity, 1);
});

test("supplier cancellation uses the latest imported snapshot without adding units", async () => {
  const offer = await fixtureOffer({ quantity: 1, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const order = await submit(cart, checkout.checkoutSession.id, `supplier-latest-${suffix()}`);
  await importSupplierQuantity(offer.offerId, 0);
  assert.equal(await offerQuantity(offer.offerId), 0);
  await OrderCancellationService.cancelOrder({ orderId: order.order.id });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 0);
  assert.equal(await offerQuantity(offer.offerId), 0);
  assert.deepEqual(await OfferService.getOffersByProductId(offer.productId, null, "uk"), []);
  await assert.rejects(
    OrderCancellationService.cancelOrder({ orderId: order.order.id }),
    /отменить нельзя/
  );
  assert.equal(await offerQuantity(offer.offerId), 0);
});

test("first supplier import after order completion releases the sale deduction", async () => {
  const offer = await fixtureOffer({ quantity: 1, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const order = await submit(cart, checkout.checkoutSession.id, `supplier-complete-${suffix()}`);
  await OrderConfirmationService.confirmOrder({ orderId: order.order.id });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await OrderCompletionService.completeOrder({ orderId: order.order.id });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await importSupplierQuantity(offer.offerId, 1);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 0);
  assert.equal(await offerQuantity(offer.offerId), 1);
  await importSupplierQuantity(offer.offerId, 1);
  assert.equal(await offerQuantity(offer.offerId), 1);
});

test("editing a supplier order adjusts only its completed-sale deduction", async () => {
  const offer = await fixtureOffer({ quantity: 3, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const result = await submit(cart, checkout.checkoutSession.id, `supplier-edit-${suffix()}`);
  const orderId = Number(result.order.id);
  const orderItemId = Number(result.orderItems[0].id);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await OrderEditingService.changeQuantity({ orderId, orderItemId, quantity: 2 });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 2);
  await OrderEditingService.changeQuantity({ orderId, orderItemId, quantity: 1 });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await OrderEditingService.removeItem({ orderId, orderItemId });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 0);
  await OrderEditingService.restoreItem({ orderId, orderItemId });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  assert.equal(await offerQuantity(offer.offerId), 3);
  const addedOffer = await fixtureOffer({
    quantity: 1, sourceType: "SUPPLIER", supplierType: "PARTNER",
  });
  const added = await OrderEditingService.addItem({
    orderId,
    productId: addedOffer.productId,
    productOfferId: addedOffer.offerId,
    quantity: 1,
  });
  assert.equal(await ReservationRepository.getReservedQuantity(addedOffer.offerId), 1);
  await OrderEditingService.removeItem({ orderId, orderItemId: added.item.id });
  assert.equal(await ReservationRepository.getReservedQuantity(addedOffer.offerId), 0);
  assert.equal(await offerQuantity(addedOffer.offerId), 1);
});

test("an existing legacy order still confirms and cancels through its historical ledger", async () => {
  const offer = await fixtureOffer({ quantity: 1 });
  const order = await OrderRepository.createOrder({
    totalAmount: 120,
    inventoryModel: "LEGACY_RESERVATION",
  });
  tracked.orders.push(Number(order.id));
  await OrderRepository.addOrderItem({
    orderId: order.id,
    productId: offer.productId,
    productOfferId: offer.offerId,
    quantity: 1,
    priceAtPurchase: 120,
  });
  await ReservationRepository.createOrderReservation({
    orderId: order.id,
    productId: offer.productId,
    productOfferId: offer.offerId,
    quantity: 1,
  });
  await OrderConfirmationService.confirmOrder({ orderId: order.id });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await OrderCancellationService.cancelOrder({ orderId: order.id });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 0);
  assert.equal(await offerQuantity(offer.offerId), 1);
});

test("supplier imports do not release historical legacy-order deductions", async () => {
  const offer = await fixtureOffer({ quantity: 1, sourceType: "SUPPLIER", supplierType: "PARTNER" });
  const order = await OrderRepository.createOrder({
    totalAmount: 120,
    inventoryModel: "LEGACY_RESERVATION",
    fulfillmentType: "SUPPLIER_ORDER",
  });
  tracked.orders.push(Number(order.id));
  await OrderRepository.addOrderItem({
    orderId: order.id,
    productId: offer.productId,
    productOfferId: offer.offerId,
    quantity: 1,
    priceAtPurchase: 120,
  });
  await ReservationRepository.createOrderReservation({
    orderId: order.id,
    productId: offer.productId,
    productOfferId: offer.offerId,
    quantity: 1,
  });
  await importSupplierQuantity(offer.offerId, 1);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await OrderConfirmationService.confirmOrder({ orderId: order.id });
  await importSupplierQuantity(offer.offerId, 1);
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 1);
  await OrderCancellationService.cancelOrder({ orderId: order.id });
  assert.equal(await ReservationRepository.getReservedQuantity(offer.offerId), 0);
  assert.equal(await offerQuantity(offer.offerId), 1);
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
  const cart = await guestCart([{ offerId: offer.offerId }]);
  const checkout = await start(cart);
  const order = await submit(cart, checkout.checkoutSession.id, `own-import-${suffix()}`);
  assert.equal(await offerQuantity(offer.offerId), 0);
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
  await OrderCancellationService.cancelOrder({ orderId: order.order.id });
  assert.equal(await offerQuantity(offer.offerId), 2);
  await assert.rejects(
    OrderCancellationService.cancelOrder({ orderId: order.order.id }),
    /отменить нельзя/
  );
  assert.equal(await offerQuantity(offer.offerId), 2);
});
