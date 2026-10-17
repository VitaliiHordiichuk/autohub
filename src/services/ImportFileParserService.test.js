import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  ImportFileParserService,
} from "./ImportFileParserService.js";


async function parseCsv(text, startRow = 1) {
  return await ImportFileParserService
    .parseFileBuffer({
      buffer:
        Buffer.from(
          text,
          "utf8"
        ),

      fileType:
        "CSV",

      startRow,
    });
}


test(
  "читает CSV с разделителем-запятой",
  async () => {
    const rows =
      await parseCsv(
        [
          "MERCEDES,A001,Фильтр,125.50,3",
          "MANN,HU7185X,Фильтр,350.00,4",
        ].join("\n")
      );

    assert.deepEqual(
      rows,
      [
        [
          "MERCEDES",
          "A001",
          "Фильтр",
          "125.50",
          "3",
        ],
        [
          "MANN",
          "HU7185X",
          "Фильтр",
          "350.00",
          "4",
        ],
      ]
    );
  }
);


test(
  "читает CSV с точкой с запятой и десятичной запятой",
  async () => {
    const rows =
      await parseCsv(
        [
          "MERCEDES;A001;Фильтр;125,50;3",
          "MANN;HU7185X;Фильтр;350,00;4",
        ].join("\n")
      );

    assert.deepEqual(
      rows[0],
      [
        "MERCEDES",
        "A001",
        "Фильтр",
        "125,50",
        "3",
      ]
    );

    assert.deepEqual(
      rows[1],
      [
        "MANN",
        "HU7185X",
        "Фильтр",
        "350,00",
        "4",
      ]
    );
  }
);


test(
  "читает CSV с вертикальной чертой",
  async () => {
    const rows =
      await parseCsv(
        [
          "MERCEDES|A001|Фильтр|125.50|3",
          "MANN|HU7185X|Фильтр|350.00|4",
        ].join("\n")
      );

    assert.equal(
      rows.length,
      2
    );

    assert.deepEqual(
      rows[0],
      [
        "MERCEDES",
        "A001",
        "Фильтр",
        "125.50",
        "3",
      ]
    );
  }
);


test(
  "не считает разделитель внутри кавычек",
  async () => {
    const rows =
      await parseCsv(
        [
          'MERCEDES;A001;"Фильтр, масляный";125,50;3',
          'MANN;HU7185X;"Фильтр | комплект";350,00;4',
        ].join("\n")
      );

    assert.equal(
      rows[0][2],
      "Фильтр, масляный"
    );

    assert.equal(
      rows[1][2],
      "Фильтр | комплект"
    );
  }
);


test(
  "учитывает стартовую строку и удаляет BOM",
  async () => {
    const rows =
      await parseCsv(
        [
          "\uFEFFШапка прайса",
          "Бренд;Артикул;Название;Цена;Количество",
          "MERCEDES;A001;Фильтр;125,50;3",
        ].join("\n"),
        3
      );

    assert.deepEqual(
      rows,
      [
        [
          "MERCEDES",
          "A001",
          "Фильтр",
          "125,50",
          "3",
        ],
      ]
    );
  }
);


test("читает XLSX SheetJS 0.20.3: стартовая строка, артикул, цена и кириллица", async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Бренд", "Артикул", "Название", "Цена", "Количество"],
    ["MERCEDES", "A4653201502", "Амортизатор", 65263, 2],
    ["MANN", "HU7185X", "Фільтр оливи", 350.5, 4],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Прайс");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const rows = await ImportFileParserService.parseFileBuffer({
    buffer: Buffer.from(buffer), fileType: "XLSX", startRow: 2,
  });
  assert.deepEqual(rows, [
    ["MERCEDES", "A4653201502", "Амортизатор", 65263, 2],
    ["MANN", "HU7185X", "Фільтр оливи", 350.5, 4],
  ]);
});
