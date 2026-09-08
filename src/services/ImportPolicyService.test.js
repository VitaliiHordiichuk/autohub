import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePriceChangePercent,
  classifyPriceChange,
  normalizeNewProductsMode,
  normalizePriceThreshold,
} from "./ImportPolicyService.js";

test(
  "нормализует режим новых товаров",
  () => {
    assert.equal(
      normalizeNewProductsMode("review"),
      "REVIEW"
    );

    assert.equal(
      normalizeNewProductsMode("auto"),
      "AUTO"
    );

    assert.equal(
      normalizeNewProductsMode("ignore"),
      "IGNORE"
    );
  }
);

test(
  "считает процент изменения цены",
  () => {
    assert.equal(
      calculatePriceChangePercent(
        1000,
        400
      ),
      -60
    );

    assert.equal(
      calculatePriceChangePercent(
        500,
        850
      ),
      70
    );

    assert.equal(
      calculatePriceChangePercent(
        0,
        100
      ),
      null
    );
  }
);

test(
  "определяет сильное падение и рост",
  () => {
    assert.equal(
      classifyPriceChange({
        changePercent: -35,
        dropThreshold: 30,
        riseThreshold: 40,
      }),
      "PRICE_DROP_ALERT"
    );

    assert.equal(
      classifyPriceChange({
        changePercent: 45,
        dropThreshold: 30,
        riseThreshold: 40,
      }),
      "PRICE_RISE_ALERT"
    );

    assert.equal(
      classifyPriceChange({
        changePercent: 10,
        dropThreshold: 30,
        riseThreshold: 40,
      }),
      "IMPORTED"
    );

    assert.equal(
      classifyPriceChange({
        changePercent: -30,
        dropThreshold: 30,
        riseThreshold: 40,
      }),
      "IMPORTED"
    );

    assert.equal(
      classifyPriceChange({
        changePercent: 40,
        dropThreshold: 30,
        riseThreshold: 40,
      }),
      "IMPORTED"
    );
  }
);

test("zero or missing prices do not produce a fictional percentage", () => {
  for (const oldPrice of [0, "0.00", null, undefined, NaN, Infinity, -1]) {
    assert.equal(calculatePriceChangePercent(oldPrice, 7204.5), null);
  }
  for (const newPrice of [null, undefined, NaN, Infinity]) {
    assert.equal(calculatePriceChangePercent(100, newPrice), null);
  }
  assert.equal(calculatePriceChangePercent(0, 0), null);
  assert.equal(calculatePriceChangePercent(100, 0), -100);
  assert.equal(calculatePriceChangePercent(100, 100), 0);
  assert.equal(classifyPriceChange({ changePercent: null, dropThreshold: 30, riseThreshold: 40 }), "IMPORTED");
});

test("tiny old prices stay within the percent field limit and still trigger a rise alert", () => {
  assert.equal(calculatePriceChangePercent(0.01, 100), 999900);
  for (const price of [100.01, 7204.5, 157585.5, 79999999.99]) {
    const changePercent = calculatePriceChangePercent(0.01, price);
    assert.equal(changePercent, 999999.99);
    assert.equal(classifyPriceChange({ changePercent, dropThreshold: 30, riseThreshold: 40 }), "PRICE_RISE_ALERT");
  }
});

test(
  "проверяет пороги изменения цены",
  () => {
    assert.equal(
      normalizePriceThreshold(
        "30,5",
        "Падение",
        { fallback: 30 }
      ),
      30.5
    );

    assert.throws(
      () =>
        normalizePriceThreshold(
          -1,
          "Падение",
          { fallback: 30 }
        ),
      /число от 0 до 100000/
    );
  }
);
