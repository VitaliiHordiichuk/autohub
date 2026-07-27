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
