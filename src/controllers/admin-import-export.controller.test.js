import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImportErrorExportRow,
} from "./admin-import-export.controller.js";


test(
  "извлекает номер строки из старого текста ошибки",
  () => {
    const row =
      buildImportErrorExportRow({
        source_row_number: null,
        error_message:
          "Строка 4: для артикула A0002000002 отсутствует название",
        brand: null,
        article: "A0002000002",
        name: null,
        quantity: "5",
        price: "200",
        raw_data: null,
      });

    assert.equal(
      row["Строка файла"],
      4
    );

    assert.equal(
      row["Причина ошибки"],
      "для артикула A0002000002 отсутствует название"
    );
  }
);


test(
  "использует сохранённый номер строки для нового импорта",
  () => {
    const row =
      buildImportErrorExportRow({
        source_row_number: 12,
        error_message:
          "Некорректная цена",
        brand: "MERCEDES",
        article: "A001",
        name: "Деталь",
        quantity: "2",
        price: null,
        raw_data: [
          "MERCEDES",
          "A001",
        ],
      });

    assert.equal(
      row["Строка файла"],
      12
    );

    assert.equal(
      row["Причина ошибки"],
      "Некорректная цена"
    );
  }
);


test(
  "понимает украинский и английский префикс строки",
  () => {
    const ukrainian =
      buildImportErrorExportRow({
        source_row_number: null,
        error_message:
          "Рядок 7: відсутня назва",
      });

    const english =
      buildImportErrorExportRow({
        source_row_number: null,
        error_message:
          "Row 9: missing name",
      });

    assert.equal(
      ukrainian["Строка файла"],
      7
    );

    assert.equal(
      ukrainian["Причина ошибки"],
      "відсутня назва"
    );

    assert.equal(
      english["Строка файла"],
      9
    );

    assert.equal(
      english["Причина ошибки"],
      "missing name"
    );
  }
);
