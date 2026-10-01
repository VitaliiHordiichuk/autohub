import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { CartRepository } from "../src/repositories/CartRepository.js";
import { CartAccessService } from "../src/services/CartAccessService.js";
import { CheckoutService } from "../src/services/CheckoutService.js";
import { OfferService, OFFER_AVAILABILITY } from "../src/services/OfferService.js";

const tracked = { carts: [], offers: [], products: [], warehouses: [] };

async function createFixture() {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2)}`;
  const warehouseResult = await pool.query(`
    INSERT INTO warehouses(name, city, type)
    VALUES($1, 'Availability test city', 'OWN')
    RETURNING id
  `, [`Reservation availability ${suffix}`]);
  const warehouseId = Number(warehouseResult.rows[0].id);
  tracked.warehouses.push(warehouseId);

  const productResult = await pool.query(`
    INSERT INTO products(article, article_normalized, name, is_active)
    VALUES($1, $1, 'Reservation availability fixture', TRUE)
    RETURNING id
  `, [`RESERVE${suffix}`]);
  const productId = Number(productResult.rows[0].id);
  tracked.products.push(productId);

  const offerResult = await pool.query(`
    INSERT INTO product_offers(
      product_id, warehouse_id, quantity, purchase_price, retail_price,
      minimum_sale_price, delivery_days, is_available, source_type,
      price_mode, is_hidden
    )
    VALUES($1, $2, 1, 80, 120, 100, 0, TRUE, 'OWN_STOCK', 'AUTO', FALSE)
    RETURNING id
  `, [productId, warehouseId]);
  const offerId = Number(offerResult.rows[0].id);
  tracked.offers.push(offerId);

  return { productId, offerId };
}

async function createGuestCart(offerId = null) {
  const { cart, guestToken } = await CartAccessService.getOrCreate({ db: pool });
  const cartId = Number(cart.id);
  tracked.carts.push(cartId);
  const item = offerId
    ? await CartRepository.addItem(cartId, offerId, 1, pool)
    : null;
  return { cartId, guestToken, item };
}

after(async () => {
  try {
    if (tracked.carts.length) {
      await pool.query("DELETE FROM stock_reservations WHERE cart_id = ANY($1::int[])", [tracked.carts]);
      await pool.query("DELETE FROM checkout_sessions WHERE cart_id = ANY($1::int[])", [tracked.carts]);
      await pool.query("DELETE FROM cart_items WHERE cart_id = ANY($1::int[])", [tracked.carts]);
      await pool.query("DELETE FROM carts WHERE id = ANY($1::int[])", [tracked.carts]);
    }
    if (tracked.offers.length) {
      await pool.query("DELETE FROM product_offers WHERE id = ANY($1::int[])", [tracked.offers]);
    }
    if (tracked.products.length) {
      await pool.query("DELETE FROM products WHERE id = ANY($1::int[])", [tracked.products]);
    }
    if (tracked.warehouses.length) {
      await pool.query("DELETE FROM warehouses WHERE id = ANY($1::int[])", [tracked.warehouses]);
    }
  } finally {
    await pool.end();
  }
});

test("PostgreSQL distinguishes foreign, own and expired checkout reservations", async () => {
  const { productId, offerId } = await createFixture();
  const owner = await createGuestCart(offerId);
  const viewer = await createGuestCart();

  const checkout = await CheckoutService.start({
    cartId: owner.cartId,
    itemIds: [Number(owner.item.id)],
    guestToken: owner.guestToken,
  });

  const [anonymousOffer] = await OfferService.getOffersByProductId(productId, null, "uk");
  assert.equal(anonymousOffer.availabilityStatus, OFFER_AVAILABILITY.RESERVED);
  assert.equal(anonymousOffer.availabilityText, "У резерві");
  assert.equal(anonymousOffer.reservationExpiresAt, null);

  const [foreignOffer] = await OfferService.getOffersByProductId(
    productId,
    null,
    "ru",
    { userId: null, cartId: viewer.cartId },
  );
  assert.equal(foreignOffer.availabilityStatus, OFFER_AVAILABILITY.RESERVED);
  assert.equal(foreignOffer.availabilityText, "В резерве");
  assert.equal(foreignOffer.reservationExpiresAt, null);

  const [ownOffer] = await OfferService.getOffersByProductId(
    productId,
    null,
    "en",
    { userId: null, cartId: owner.cartId },
  );
  assert.equal(ownOffer.availabilityStatus, OFFER_AVAILABILITY.RESERVED_FOR_YOU);
  assert.equal(ownOffer.availabilityText, "Reserved for you");
  assert.ok(Date.parse(ownOffer.reservationExpiresAt) > Date.now());

  await pool.query(`
    UPDATE stock_reservations
    SET reserved_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
    WHERE checkout_session_id = $1
  `, [checkout.checkoutSession.id]);
  await pool.query(`
    UPDATE checkout_sessions
    SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
    WHERE id = $1
  `, [checkout.checkoutSession.id]);

  const [availableAgain] = await OfferService.getOffersByProductId(productId, null, "uk");
  assert.equal(availableAgain.availabilityStatus, OFFER_AVAILABILITY.AVAILABLE);
  assert.equal(availableAgain.quantity, 1);

  const physical = await pool.query("SELECT quantity FROM product_offers WHERE id = $1", [offerId]);
  assert.equal(Number(physical.rows[0].quantity), 1);
});
