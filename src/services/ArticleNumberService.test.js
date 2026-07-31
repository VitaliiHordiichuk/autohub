import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAutomaticMercedesN,
  isMercedesBrandName,
} from "./ArticleNumberService.js";


test(
  "распознаёт бренд Mercedes-Benz",
  () => {
    assert.equal(
      isMercedesBrandName(
        "Mercedes-Benz"
      ),
      true
    );

    assert.equal(
      isMercedesBrandName("MANN"),
      false
    );
  }
);


test(
  "добавляет N только цифровому Mercedes номеру длиной 12 и больше",
  () => {
    assert.equal(
      applyAutomaticMercedesN({
        brandName:
          "Mercedes-Benz",
        articleNormalized:
          "000000000069",
      }),
      "N000000000069"
    );

    assert.equal(
      applyAutomaticMercedesN({
        brandName:
          "Mercedes-Benz",
        articleNormalized:
          "1234567890123456",
      }),
      "N1234567890123456"
    );

    assert.equal(
      applyAutomaticMercedesN({
        brandName:
          "Mercedes-Benz",
        articleNormalized:
          "1234567890",
      }),
      "1234567890"
    );

    assert.equal(
      applyAutomaticMercedesN({
        brandName: "MANN",
        articleNormalized:
          "123456789012",
      }),
      "123456789012"
    );
  }
);
