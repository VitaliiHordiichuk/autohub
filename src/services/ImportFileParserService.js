import { Readable } from "node:stream";
import csvParser from "csv-parser";
import * as XLSX from "xlsx";


function normalizeStartRow(startRow) {
  const value = Number(startRow);

  if (!Number.isInteger(value) || value <= 0) {
    return 1;
  }

  return value;
}


function cleanRow(row) {
  return row.map((value, index) => {
    if (index === 0 && typeof value === "string") {
      return value.replace(/^\uFEFF/, "");
    }

    return value;
  });
}


function parseCsvBuffer(
  buffer,
  startRow = 1
) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const normalizedStartRow =
      normalizeStartRow(startRow);

    Readable.from(buffer)
      .pipe(
        csvParser({
          separator: ",",
          headers: false,
          skipLines:
            normalizedStartRow - 1,
        })
      )
      .on("data", (row) => {
        rows.push(
          cleanRow(
            Object.values(row)
          )
        );
      })
      .on("end", () => {
        resolve(rows);
      })
      .on("error", reject);
  });
}


function parseXlsxBuffer(
  buffer,
  startRow = 1
) {
  const workbook = XLSX.read(
    buffer,
    {
      type: "buffer",
      cellDates: false,
    }
  );

  const firstSheetName =
    workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  const sheet =
    workbook.Sheets[firstSheetName];

  const allRows =
    XLSX.utils.sheet_to_json(
      sheet,
      {
        header: 1,
        defval: "",
        raw: true,
        blankrows: false,
      }
    );

  const normalizedStartRow =
    normalizeStartRow(startRow);

  return allRows
    .slice(normalizedStartRow - 1)
    .map(cleanRow);
}


function detectFileType(fileName) {
  const normalizedName =
    String(fileName || "")
      .trim()
      .toLowerCase();

  if (normalizedName.endsWith(".csv")) {
    return "CSV";
  }

  if (normalizedName.endsWith(".xlsx")) {
    return "XLSX";
  }

  return null;
}


export const ImportFileParserService = {

  detectFileType,


  async parseFileBuffer(
    {
      buffer,
      fileType,
      startRow = 1,
    }
  ) {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error(
        "Не удалось прочитать содержимое файла"
      );
    }

    const normalizedFileType =
      String(fileType || "")
        .trim()
        .toUpperCase();

    if (normalizedFileType === "CSV") {
      return parseCsvBuffer(
        buffer,
        startRow
      );
    }

    if (normalizedFileType === "XLSX") {
      return parseXlsxBuffer(
        buffer,
        startRow
      );
    }

    throw new Error(
      "Поддерживаются только файлы CSV и XLSX"
    );
  },

};