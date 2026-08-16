import test from "node:test";
import assert from "node:assert/strict";

import { selectCheckoutItems } from "./CheckoutService.js";
import {
  buildOrderComment,
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
    /вибраних позицій кошика не знайдено/
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

test("добавляет VIN и просьбу о проверке в комментарий заказа", () => {
  const comment = buildOrderComment({
    comment: "Позвонить перед отправкой",
    vinCheckRequested: true,
    vin: "WDB12345678901234",
  });

  assert.match(comment, /ПЕРЕВІРИТИ ЗА VIN/);
  assert.match(comment, /VIN: WDB12345678901234/);
  assert.match(comment, /Позвонить перед отправкой/);
});

test("не создаёт заказ с некорректным VIN для проверки", () => {
  assert.throws(
    () => buildOrderComment({ vinCheckRequested: true, vin: "SHORT" }),
    /VIN має містити 17 символів/
  );
});
