import test from "node:test";
import assert from "node:assert/strict";

import { ReservationRepository } from "./ReservationRepository.js";

test("pending and confirmed order reservations do not expire from availability", async () => {
  let executedSql = "";
  const db = {
    async query(sql) {
      executedSql = sql;
      return { rows: [{ reserved_quantity: "1" }] };
    },
  };

  const reserved = await ReservationRepository.getReservedQuantity(
    10,
    20,
    db
  );

  assert.equal(reserved, 1);
  assert.match(executedSql, /status = 'ORDER_PENDING'/);
  assert.match(executedSql, /order_id IS NOT NULL/);
});

test("order reservation with null cart item is not excluded", async () => {
  let executedSql = "";
  const db = {
    async query(sql) {
      executedSql = sql;
      return { rows: [{ reserved_quantity: "1" }] };
    },
  };

  await ReservationRepository.getReservedQuantity(10, 20, db);

  assert.match(
    executedSql,
    /cart_item_id IS DISTINCT FROM \$2/
  );
  assert.doesNotMatch(executedSql, /cart_item_id <> \$2/);
});

test("attaching reservation to order removes checkout expiration", async () => {
  let executedSql = "";
  const db = {
    async query(sql) {
      executedSql = sql;
      return { rows: [] };
    },
  };

  await ReservationRepository.attachToOrder(5, 7, db);

  assert.match(executedSql, /status = 'ORDER_PENDING'/);
  assert.match(executedSql, /reserved_until = NULL/);
});

test("releasing an old cart hold cannot release an order-linked sale", async () => {
  let executedSql = "";
  const db = {
    async query(sql) {
      executedSql = sql;
      return { rows: [] };
    },
  };

  await ReservationRepository.releaseActiveByCartId(5, db);
  assert.match(executedSql, /status = 'ACTIVE' AND order_id IS NULL/);
});
