// import { Readable } from "node:stream";
// import csvParser from "csv-parser";

// import { ImportService } from "../services/ImportService.js";
// import { WarehouseImportSettingsRepository } from "../repositories/WarehouseImportSettingsRepository.js";


// function parseCsvBuffer(
//   buffer,
//   startRow = 1
// ) {

//   return new Promise((resolve, reject) => {

//     const rows = [];


//     Readable.from(buffer)
//       .pipe(
//         csvParser({
//           separator: ",",
//           headers: false,
//           skipLines: startRow - 1,
//         })
//       )

//       .on("data", (row) => {

//         rows.push(
//           Object.values(row)
//         );

//       })

//       .on("end", () => {

//         resolve(rows);

//       })

//       .on("error", reject);

//   });

// }



// function readColumn(
//   row,
//   columnNumber
// ) {

//   if (
//     columnNumber === null ||
//     columnNumber === undefined
//   ) {
//     return null;
//   }


//   return row[columnNumber - 1] ?? null;

// }




// function normalizeImportedRow(
//   row,
//   settings,
//   rowNumber
// ) {


//   const article =
//     String(
//       readColumn(
//         row,
//         settings.article_column
//       ) ?? ""
//     ).trim();



//   const name =
//     String(
//       readColumn(
//         row,
//         settings.name_column
//       ) ?? ""
//     ).trim();



//   const quantity =
//     Number(
//       String(
//         readColumn(
//           row,
//           settings.quantity_column
//         ) ?? ""
//       )
//       .trim()
//       .replace(",", ".")
//     );



//   const price =
//     Number(
//       String(
//         readColumn(
//           row,
//           settings.price_column
//         ) ?? ""
//       )
//       .trim()
//       .replace(",", ".")
//     );



//   let brand = null;



//   if (
//     settings.brand_mode === "FROM_FILE"
//   ) {


//     brand =
//       String(
//         readColumn(
//           row,
//           settings.brand_column
//         ) ?? ""
//       ).trim();



//     if (!brand) {

//       throw new Error(
//         `Строка ${rowNumber}: не указан бренд`
//       );

//     }

//   }




//   if (!article) {

//     throw new Error(
//       `Строка ${rowNumber}: отсутствует артикул`
//     );

//   }




//   if (!name) {

//     throw new Error(
//       `Строка ${rowNumber}: для артикула ${article} отсутствует название`
//     );

//   }




//   if (
//     !Number.isFinite(quantity) ||
//     quantity < 0
//   ) {

//     throw new Error(
//       `Строка ${rowNumber}: некорректное количество для артикула ${article}`
//     );

//   }





//   if (
//     !Number.isFinite(price) ||
//     price < 0
//   ) {

//     throw new Error(
//       `Строка ${rowNumber}: некорректная цена для артикула ${article}`
//     );

//   }



//   return {

//     brand:
//       brand || null,

//     article,

//     name,

//     quantity,

//     price,

//   };

// }





// function buildImportErrorRow(
//   row,
//   settings,
//   error,
//   rowNumber
// ) {


//   return {

//     rowNumber,


//     article:
//       readColumn(
//         row,
//         settings.article_column
//       ),


//     name:
//       readColumn(
//         row,
//         settings.name_column
//       ),


//     quantity:
//       readColumn(
//         row,
//         settings.quantity_column
//       ),


//     price:
//       readColumn(
//         row,
//         settings.price_column
//       ),


//     brand:
//       settings.brand_mode === "FROM_FILE"
//         ? readColumn(
//             row,
//             settings.brand_column
//           )
//         : null,


//     error:
//       error.message,

//   };

// }





// export async function testImport(
//   req,
//   res
// ) {


//   try {


//     const rows = [

//       {
//         article: "A0001800109",
//         name: "Масляный фильтр Mercedes",
//         price: 350,
//         quantity: 5,
//       }

//     ];



//     const result =
//       await ImportService.importRows(
//         1,
//         rows,
//         []
//       );



//     return res.json({

//       success:true,

//       result,

//     });



//   } catch(error) {


//     console.error(
//       "Ошибка тестового импорта:",
//       error
//     );


//     return res.status(400).json({

//       success:false,

//       error:error.message,

//     });

//   }

// }





// export async function uploadImport(
//   req,
//   res
// ) {


//   try {


//     if (!req.file) {

//       throw new Error(
//         "CSV-файл не загружен"
//       );

//     }




//     const warehouseId =
//       Number(req.body.warehouseId);



//     if (
//       !Number.isInteger(warehouseId) ||
//       warehouseId <= 0
//     ) {

//       throw new Error(
//         "Некорректный номер склада"
//       );

//     }




//     const settings =
//       await WarehouseImportSettingsRepository
//         .findByWarehouseId(
//           warehouseId
//         );



//     if (!settings) {

//       throw new Error(
//         "Для склада не настроены параметры импорта"
//       );

//     }





//     const parsedRows =
//       await parseCsvBuffer(
//         req.file.buffer,
//         settings.start_row
//       );



//     if (
//       parsedRows.length === 0
//     ) {

//       throw new Error(
//         "CSV-файл не содержит данных"
//       );

//     }





//     const rows = [];

//     const importErrors = [];




//     parsedRows.forEach(
//       (row,index)=>{


//         try {


//           rows.push(

//             normalizeImportedRow(
//               row,
//               settings,
//               index + settings.start_row
//             )

//           );



//         } catch(error) {



//           importErrors.push(

//             buildImportErrorRow(
//               row,
//               settings,
//               error,
//               index + settings.start_row
//             )

//           );


//         }


//       }

//     );






//     const result =
//       await ImportService.importRows(
//         warehouseId,
//         rows,
//         importErrors
//       );





//     return res.json({

//       success:true,

//       message:"CSV-файл импортирован",


//       file:{

//         name:req.file.originalname,

//         size:req.file.size,

//       },


//       result,


//     });





//   } catch(error) {


//     console.error(
//       "Ошибка импорта CSV:",
//       error
//     );


//     return res.status(400).json({

//       success:false,

//       error:error.message,

//     });


//   }

// }






// export async function previewImport(
//   req,
//   res
// ) {


//   try {


//     if (!req.file) {

//       throw new Error(
//         "CSV-файл не загружен"
//       );

//     }



//     const warehouseId =
//       Number(req.body.warehouseId);



//     const settings =
//       await WarehouseImportSettingsRepository
//         .findByWarehouseId(
//           warehouseId
//         );



//     if (!settings) {

//       throw new Error(
//         "Для склада не настроены параметры импорта"
//       );

//     }





//     const parsedRows =
//       await parseCsvBuffer(
//         req.file.buffer,
//         settings.start_row
//       );



//     const rows = [];

//     const errors = [];



//     parsedRows.forEach(
//       (row,index)=>{


//         try {


//           rows.push(

//             normalizeImportedRow(
//               row,
//               settings,
//               index + settings.start_row
//             )

//           );



//         } catch(error) {


//           errors.push(

//             buildImportErrorRow(
//               row,
//               settings,
//               error,
//               index + settings.start_row
//             )

//           );


//         }


//       }

//     );




//     return res.json({

//       success:true,

//       preview:
//         rows.slice(0,10),

//       errors:
//         errors.slice(0,10),

//       totalRows:
//         parsedRows.length,

//     });




//   } catch(error) {


//     console.error(
//       "Ошибка предпросмотра CSV:",
//       error
//     );



//     return res.status(400).json({

//       success:false,

//       error:error.message,

//     });


//   }

// }
import { ImportService } from "../services/ImportService.js";
import { ImportFileParserService } from "../services/ImportFileParserService.js";
import { WarehouseSupplierImportRepository } from "../repositories/WarehouseSupplierImportRepository.js";

import { ImportRepository }
from "../repositories/ImportRepository.js";
import {
  BrandAliasRepository,
  normalizeBrandAlias,
} from "../repositories/BrandAliasRepository.js";


function readColumn(
  row,
  columnNumber
) {
  if (
    columnNumber === null ||
    columnNumber === undefined
  ) {
    return null;
  }

  return row[columnNumber - 1] ?? null;
}


function normalizeImportedRow(
  row,
  settings,
  rowNumber
) {
  const article = String(
    readColumn(
      row,
      settings.article_column
    ) ?? ""
  ).trim();

  const name = String(
    readColumn(
      row,
      settings.name_column
    ) ?? ""
  ).trim();

  const quantity = Number(
    String(
      readColumn(
        row,
        settings.quantity_column
      ) ?? ""
    )
      .trim()
      .replace(",", ".")
  );

  const price = Number(
    String(
      readColumn(
        row,
        settings.price_column
      ) ?? ""
    )
      .trim()
      .replace(",", ".")
  );

  let brand = null;

  if (
    settings.brand_mode === "FROM_FILE"
  ) {
    brand = String(
      readColumn(
        row,
        settings.brand_column
      ) ?? ""
    ).trim();

    if (!brand) {
      throw new Error(
        `Строка ${rowNumber}: не указан бренд`
      );
    }
  }

  if (!article) {
    throw new Error(
      `Строка ${rowNumber}: отсутствует артикул`
    );
  }

  if (!name) {
    throw new Error(
      `Строка ${rowNumber}: для артикула ${article} отсутствует название`
    );
  }

  if (
    !Number.isFinite(quantity) ||
    quantity < 0
  ) {
    throw new Error(
      `Строка ${rowNumber}: некорректное количество для артикула ${article}`
    );
  }

  if (
    !Number.isFinite(price) ||
    price < 0
  ) {
    throw new Error(
      `Строка ${rowNumber}: некорректная цена для артикула ${article}`
    );
  }

  return {
    rowNumber,
    rawData: row,

    brand:
      brand || null,
    article,
    name,
    quantity,
    price,
  };
}


function buildImportErrorRow(
  row,
  settings,
  error,
  rowNumber
) {
  return {
    rowNumber,
    rawData: row,

    article:
      readColumn(
        row,
        settings.article_column
      ),

    name:
      readColumn(
        row,
        settings.name_column
      ),

    quantity:
      readColumn(
        row,
        settings.quantity_column
      ),

    price:
      readColumn(
        row,
        settings.price_column
      ),

    brand:
      settings.brand_mode === "FROM_FILE"
        ? readColumn(
            row,
            settings.brand_column
          )
        : null,

    error:
      error.message,
  };
}


function parsePositiveInteger(
  value,
  errorMessage,
  {
    nullable = false,
  } = {}
) {
  if (
    nullable &&
    (
      value === undefined ||
      value === null ||
      value === ""
    )
  ) {
    return null;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(errorMessage);
  }

  return parsed;
}


async function resolveImportSettings(
  {
    warehouseId,
    warehouseSupplierImportId,
  }
) {
  const settings =
    warehouseSupplierImportId
      ? await WarehouseSupplierImportRepository
          .findById(
            warehouseSupplierImportId
          )
      : await WarehouseSupplierImportRepository
          .findByWarehouseId(
            warehouseId
          );

  if (!settings) {
    throw new Error(
      "Для склада не настроена активная связь с поставщиком"
    );
  }

  if (
    Number(settings.warehouse_id) !==
    warehouseId
  ) {
    throw new Error(
      "Настройка импорта не принадлежит указанному складу"
    );
  }

  return settings;
}


function normalizeFileType(fileName) {
  const detectedFileType =
    ImportFileParserService.detectFileType(fileName);

  if (!detectedFileType) {
    throw new Error(
      "Поддерживаются только файлы CSV и XLSX"
    );
  }

  return detectedFileType;
}


async function normalizeRows(
  parsedRows,
  settings
) {
  const rows = [];
  const importErrors = [];
  const startRow =
    Number(settings.start_row) || 1;

  const brandCache =
    new Map();

  for (
    let index = 0;
    index < parsedRows.length;
    index += 1
  ) {
    const row =
      parsedRows[index];

    const rowNumber =
      index + startRow;

    try {
      const normalizedRow =
        normalizeImportedRow(
          row,
          settings,
          rowNumber
        );

      if (
        settings.brand_mode ===
        "FROM_FILE"
      ) {
        const cacheKey =
          normalizeBrandAlias(
            normalizedRow.brand
          );

        let matchedBrand =
          brandCache.get(
            cacheKey
          );

        if (
          matchedBrand ===
          undefined
        ) {
          matchedBrand =
            await BrandAliasRepository
              .findByAlias(
                normalizedRow.brand
              );

          brandCache.set(
            cacheKey,
            matchedBrand
          );
        }

        if (!matchedBrand) {
          throw new Error(
            `Строка ${rowNumber}: бренд «${normalizedRow.brand}» не найден`
          );
        }
      }

      rows.push(
        normalizedRow
      );
    } catch(error) {
      importErrors.push(
        buildImportErrorRow(
          row,
          settings,
          error,
          rowNumber
        )
      );
    }
  }

  return {
    rows,
    importErrors,
  };
}


export async function testImport(
  req,
  res
) {
  try {
    const rows = [
      {
        article: "A0001800109",
        name: "Масляный фильтр Mercedes",
        price: 350,
        quantity: 5,
      },
    ];

    const result =
      await ImportService.importRows(
        1,
        rows,
        []
      );

    return res.json({
      success: true,
      result,
    });
  } catch(error) {
    console.error(
      "Ошибка тестового импорта:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function uploadImport(
  req,
  res
) {
  try {
    if (!req.file) {
      throw new Error(
        "Файл не загружен"
      );
    }

    const warehouseId =
      parsePositiveInteger(
        req.body.warehouseId,
        "Некорректный номер склада"
      );

    const warehouseSupplierImportId =
      parsePositiveInteger(
        req.body.warehouseSupplierImportId,
        "Некорректный номер настройки импорта склада",
        {
          nullable: true,
        }
      );

    const settings =
      await resolveImportSettings({
        warehouseId,
        warehouseSupplierImportId,
      });

    const fileType =
      normalizeFileType(
        req.file.originalname,
        settings.file_type
      );

    const parsedRows =
      await ImportFileParserService
        .parseFileBuffer({
          buffer:
            req.file.buffer,
          fileType,
          startRow:
            settings.start_row,
        });

    if (parsedRows.length === 0) {
      throw new Error(
        "Файл не содержит данных"
      );
    }

    const {
      rows,
      importErrors,
    } = await normalizeRows(
      parsedRows,
      settings
    );

    const result =
      await ImportService.importRows(
        {
          warehouseId,

          warehouseSupplierImportId:
            settings.id,

          fileName:
            req.file.originalname,

          fileType,

          importMethod:
            "MANUAL",
        },
        rows,
        importErrors
      );

    return res.json({
      success: true,

      message:
        `${fileType}-файл импортирован`,

      file: {
        name:
          req.file.originalname,

        size:
          req.file.size,

        type:
          fileType,
      },

      result,
    });
  } catch(error) {
    console.error(
      "Ошибка импорта файла:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function previewImport(
  req,
  res
) {
  try {
    if (!req.file) {
      throw new Error(
        "Файл не загружен"
      );
    }

    const warehouseId =
      parsePositiveInteger(
        req.body.warehouseId,
        "Некорректный номер склада"
      );

    const warehouseSupplierImportId =
      parsePositiveInteger(
        req.body.warehouseSupplierImportId,
        "Некорректный номер настройки импорта склада",
        {
          nullable: true,
        }
      );

    const settings =
      await resolveImportSettings({
        warehouseId,
        warehouseSupplierImportId,
      });

    const fileType =
      normalizeFileType(
        req.file.originalname,
        settings.file_type
      );

    const parsedRows =
      await ImportFileParserService
        .parseFileBuffer({
          buffer:
            req.file.buffer,
          fileType,
          startRow:
            settings.start_row,
        });

    if (parsedRows.length === 0) {
      throw new Error(
        "Файл не содержит данных"
      );
    }

    const {
      rows,
      importErrors,
    } = await normalizeRows(
      parsedRows,
      settings
    );

    return res.json({
      success: true,

      file: {
        name:
          req.file.originalname,

        size:
          req.file.size,

        type:
          fileType,
      },

      import: {
        warehouseId,

        supplierId:
          settings.supplier_id,

        warehouseSupplierImportId:
          settings.id,

        configuredMethod:
          settings.import_method,
      },

      preview:
        rows.slice(0, 10),

      errors:
        importErrors.slice(0, 10),

      totalRows:
        parsedRows.length,

      readyRows:
        rows.length,

      errorRows:
        importErrors.length,
    });
  } catch(error) {
    console.error(
      "Ошибка предпросмотра файла:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function getImportHistory(
  req,
  res
) {
  try {
    const warehouseId =
      parsePositiveInteger(
        req.query.warehouseId,
        "Некорректный номер склада"
      );

    const requestedLimit =
      Number(
        req.query.limit ?? 20
      );

    const limit =
      Number.isInteger(
        requestedLimit
      ) &&
      requestedLimit > 0
        ? Math.min(
            requestedLimit,
            100
          )
        : 20;

    const rows =
      await ImportRepository
        .findHistoryByWarehouse({
          warehouseId,
          limit,
        });

    return res.json({
      success: true,
      warehouseId,
      count: rows.length,

      imports:
        rows.map(
          (row) => ({
            id:
              Number(row.id),

            warehouseId:
              Number(
                row.warehouse_id
              ),

            supplierId:
              row.supplier_id === null
                ? null
                : Number(
                    row.supplier_id
                  ),

            warehouseSupplierImportId:
              row.warehouse_supplier_import_id ===
              null
                ? null
                : Number(
                    row
                      .warehouse_supplier_import_id
                  ),

            source:
              row.source,

            fileName:
              row.file_name,

            fileType:
              row.file_type,

            importMethod:
              row.import_method,

            status:
              row.status,

            totalRows:
              Number(
                row.total_rows ?? 0
              ),

            successRows:
              Number(
                row.success_rows ?? 0
              ),

            errorRows:
              Number(
                row.error_rows ?? 0
              ),

            createdAt:
              row.created_at,
          })
        ),
    });
  } catch(error) {
    console.error(
      "Ошибка получения истории импортов:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function getImportErrors(
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

    return res.json({
      success: true,
      importId,
      warehouseId,
      count: rows.length,

      errors:
        rows.map(
          (row) => ({
            id:
              Number(row.id),

            sourceRowNumber:
              row.source_row_number === null
                ? null
                : Number(
                    row.source_row_number
                  ),

            article:
              row.article,

            name:
              row.name,

            price:
              row.price,

            quantity:
              row.quantity,

            brand:
              row.brand,

            errorMessage:
              row.error_message,

            rawData:
              row.raw_data,

            createdAt:
              row.created_at,
          })
        ),
    });
  } catch(error) {
    console.error(
      "Ошибка получения строк импорта:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

