import test from "node:test";
import assert from "node:assert/strict";

import { selectCheckoutItems } from "./CheckoutService.js";
import {
  cartHasRemainingItems,
  selectReservedCartItems,
} from "../use-cases/checkout/SubmitOrder.js";

const cartItems = [
  { id: 11, article: "ONE" },
  { id: 12, article: "TWO" },
  { id: 13, article: "THREE" },
  { id: 14, article: "FOUR" },
  { id: 15, article: "FIVE" },
];

test("оформляет только отмеченные позиции корзины", () => {
  const selected = selectCheckoutItems(cartItems, [11, 13, 15]);
  assert.deepEqual(selected.map((item) => item.id), [11, 13, 15]);
});

test("не позволяет оформить позицию из чужой или устаревшей корзины", () => {
  assert.throws(
    () => selectCheckoutItems(cartItems, [11, 999]),
    /выбранных позиций корзины не найдены/
  );
});

test("после частичного заказа оставляет неотмеченные позиции в корзине", () => {
  const reservations = [
    { cart_item_id: 11 },
    { cart_item_id: 13 },
    { cart_item_id: 15 },
  ];
  const ordered = selectReservedCartItems(cartItems, reservations);

  assert.deepEqual(ordered.map((item) => item.id), [11, 13, 15]);
  assert.equal(cartHasRemainingItems(cartItems, ordered), true);
  assert.deepEqual(
    cartItems.filter((item) => !ordered.includes(item)).map((item) => item.id),
    [12, 14]
  );
});

test("закрывает корзину, если заказаны все позиции", () => {
  assert.equal(cartHasRemainingItems(cartItems, cartItems), false);
});
