import test from "node:test";
import assert from "node:assert/strict";

import {
  clampDatabasePercent,
  databaseNumberOrNull,
  OFFER_NUMBER_MAX_EXCLUSIVE,
  parseImportNumber,
} from "./ImportNumericService.js";


test(
  "читает число из прайса с пробелами и запятой",
  () => {
    assert.equal(
      parseImportNumber(
        "1 234,56",
        {
          fieldName: "цена",
          article: "A0000000001",
          rowNumber: 7,
        }
      ),
      1234.56
    );
  }
);


test(
  "объясняет слишком большое число и советует проверить колонку",
  () => {
    assert.throws(
      () => parseImportNumber(
        "99999999.995",
        {
          fieldName: "цена",
          article: "A0000000001",
          rowNumber: 12,
        }
      ),
      (error) => {
        assert.match(
          error.message,
          /Строка 12/
        );
        assert.match(
          error.message,
          /99 999 999,99/
        );
        assert.match(
          error.message,
          /выбрана колонка файла/
        );
        return true;
      }
    );
  }
);


test(
  "не переносит переполненное число в строку отчёта импорта",
  () => {
    assert.equal(
      databaseNumberOrNull(
        100_000_000,
        OFFER_NUMBER_MAX_EXCLUSIVE
      ),
      null
    );

    assert.equal(
      databaseNumberOrNull(
        99_999_999.99,
        OFFER_NUMBER_MAX_EXCLUSIVE
      ),
      99_999_999.99
    );
  }
);


test(
  "ограничивает процент изменения размером поля базы",
  () => {
    assert.equal(
      clampDatabasePercent(
        5_000_000
      ),
      999_999.99
    );

    assert.equal(
      clampDatabasePercent(
        -5_000_000
      ),
      -999_999.99
    );
  }
);
