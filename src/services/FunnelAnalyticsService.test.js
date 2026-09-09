import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePublicFunnelEvent,
} from "./FunnelAnalyticsService.js";


test(
  "нормализует публичный просмотр товара",
  () => {
    assert.deepEqual(
      normalizePublicFunnelEvent({
        eventType: " product_view ",
        productId: "42",
        source: "PRODUCT_PAGE",
        locale: "ru",
      }),
      {
        eventType: "PRODUCT_VIEW",
        productId: 42,
        source: "PRODUCT_PAGE",
        locale: "ru",
      }
    );
  }
);


test(
  "публичный API не принимает серверные этапы воронки",
  () => {
    assert.throws(
      () =>
        normalizePublicFunnelEvent({
          eventType: "ORDER_CREATED",
          productId: 42,
        }),
      (error) =>
        error.statusCode === 400
    );

    assert.throws(
      () =>
        normalizePublicFunnelEvent({
          eventType: "PRODUCT_VIEW",
          productId: 0,
        }),
      (error) =>
        error.statusCode === 400
    );
  }
);
