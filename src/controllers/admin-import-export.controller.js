import * as XLSX from "xlsx";

import { ImportRepository }
from "../repositories/ImportRepository.js";


function parsePositiveInteger(
  value,
  errorMessage
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(errorMessage);
  }

  return parsed;
}


function formatRawData(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    return String(value);
  }
}


function extractLegacyRowNumber(
  errorMessage
) {
  const text =
    String(
      errorMessage ?? ""
    ).trim();

  const match =
    text.match(
      /^(?:Строка|Рядок|Row)\s+(\d+)\s*:\s*/i
    );

  if (!match) {
    return {
      rowNumber: null,
      cleanMessage: text,
    };
  }

  return {
    rowNumber:
      Number(match[1]),

    cleanMessage:
      text
        .slice(
          match[0].length
        )
        .trim(),
  };
}


export function buildImportErrorExportRow(
  row
) {
  const legacy =
    extractLegacyRowNumber(
      row.error_message
    );

  const storedRowNumber =
    row.source_row_number === null ||
    row.source_row_number === undefined
      ? null
      : Number(
          row.source_row_number
        );

  return {
    "Строка файла":
      Number.isInteger(
        storedRowNumber
      )
        ? storedRowNumber
        : legacy.rowNumber ?? "",

    "Бренд":
      row.brand ?? "",

    "Артикул":
      row.article ?? "",

    "Название":
      row.name ?? "",

    "Количество":
      row.quantity === null ||
      row.quantity === undefined
        ? ""
        : Number(row.quantity),

    "Цена":
      row.price === null ||
      row.price === undefined
        ? ""
        : Number(row.price),

    "Причина ошибки":
      legacy.cleanMessage,

    "Исходные данные":
      formatRawData(
        row.raw_data
      ),
  };
}


export async function downloadImportErrorsXlsx(
  req,
  res
) {
  try {
    const importId =
      parsePositiveInteger(
        req.params.importId,
        "Некорректный номер импорта"
      );

    const warehouseId =
      parsePositiveInteger(
        req.query.warehouseId,
        "Некорректный номер склада"
      );

    const rows =
      await ImportRepository
        .findErrorRows({
          importId,
          warehouseId,
        });

    const exportRows =
      rows.map(
        buildImportErrorExportRow
      );

    const headers = [
      "Строка файла",
      "Бренд",
      "Артикул",
      "Название",
      "Количество",
      "Цена",
      "Причина ошибки",
      "Исходные данные",
    ];

    const worksheet =
      exportRows.length > 0
        ? XLSX.utils.json_to_sheet(
            exportRows,
            {
              header: headers,
            }
          )
        : XLSX.utils.aoa_to_sheet([
            headers,
          ]);

    worksheet["!cols"] = [
      { wch: 14 },
      { wch: 18 },
      { wch: 24 },
      { wch: 42 },
      { wch: 14 },
      { wch: 14 },
      { wch: 55 },
      { wch: 60 },
    ];

    worksheet["!autofilter"] = {
      ref:
        worksheet["!ref"] ||
        "A1:H1",
    };

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Ошибки импорта"
    );

    const buffer =
      XLSX.write(
        workbook,
        {
          type: "buffer",
          bookType: "xlsx",
        }
      );

    const fileName =
      `import-errors-${importId}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    res.setHeader(
      "Content-Length",
      buffer.length
    );

    return res.send(buffer);
  } catch(error) {
    console.error(
      "Ошибка выгрузки ошибок импорта:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
