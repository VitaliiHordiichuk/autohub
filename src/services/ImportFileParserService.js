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


const CSV_DELIMITERS = [
  ",",
  ";",
  "|",
];


function countDelimiterOutsideQuotes(
  line,
  delimiter
) {
  let count = 0;
  let insideQuotes = false;

  for (
    let index = 0;
    index < line.length;
    index++
  ) {
    const character =
      line[index];

    if (character === '"') {
      const nextCharacter =
        line[index + 1];

      if (
        insideQuotes &&
        nextCharacter === '"'
      ) {
        index++;
        continue;
      }

      insideQuotes =
        !insideQuotes;

      continue;
    }

    if (
      !insideQuotes &&
      character === delimiter
    ) {
      count++;
    }
  }

  return count;
}


function detectCsvSeparator(buffer) {
  const text =
    buffer
      .toString("utf8")
      .replace(/^\uFEFF/, "");

  const sampleLines =
    text
      .split(/\r?\n/)
      .map(
        (line) =>
          line.trim()
      )
      .filter(Boolean)
      .slice(0, 20);

  if (!sampleLines.length) {
    return ",";
  }

  let bestDelimiter = ",";
  let bestScore = -1;

  for (
    const delimiter
    of CSV_DELIMITERS
  ) {
    const counts =
      sampleLines.map(
        (line) =>
          countDelimiterOutsideQuotes(
            line,
            delimiter
          )
      );

    const positiveCounts =
      counts.filter(
        (count) =>
          count > 0
      );

    if (!positiveCounts.length) {
      continue;
    }

    const frequency = new Map();

    for (
      const count
      of positiveCounts
    ) {
      frequency.set(
        count,
        (frequency.get(count) || 0) + 1
      );
    }

    let mostCommonCount = 0;
    let matchingLines = 0;

    for (
      const [
        count,
        occurrences,
      ]
      of frequency
    ) {
      if (
        occurrences > matchingLines ||
        (
          occurrences === matchingLines &&
          count > mostCommonCount
        )
      ) {
        mostCommonCount =
          count;

        matchingLines =
          occurrences;
      }
    }

    const consistency =
      matchingLines /
      sampleLines.length;

    const score =
      (
        consistency * 1000
      ) +
      (
        mostCommonCount * 10
      ) +
      matchingLines;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}


function parseCsvBuffer(
  buffer,
  startRow = 1
) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const normalizedStartRow =
      normalizeStartRow(startRow);

    const separator =
      detectCsvSeparator(buffer);

    Readable.from(buffer)
      .pipe(
        csvParser({
          separator,
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