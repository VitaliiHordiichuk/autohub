import { WarehouseImportSettingsRepository } 
from "../repositories/WarehouseImportSettingsRepository.js";


export const WarehouseImportSettingsService = {


  async getSettings(warehouseId) {

    return await WarehouseImportSettingsRepository
      .findByWarehouseId(
        warehouseId
      );

  },


  async createSettings(
    warehouseId,
    data
  ) {


    const exists =
      await WarehouseImportSettingsRepository
        .findByWarehouseId(
          warehouseId
        );


    if (exists) {
      throw new Error(
        "Настройки импорта для этого склада уже существуют"
      );
    }


    this.validate(data);


    return await WarehouseImportSettingsRepository
      .create({
        warehouseId,

        brandMode:
          data.brandMode ?? "FROM_FILE",

        fixedBrandId:
          data.fixedBrandId ?? null,

        brandColumn:
          data.brandColumn ?? null,

        articleColumn:
          data.articleColumn ?? 1,

        nameColumn:
          data.nameColumn ?? 2,

        priceColumn:
          data.priceColumn ?? 3,

        quantityColumn:
          data.quantityColumn ?? 4,
      });

  },


  async updateSettings(
    warehouseId,
    data
  ) {


    this.validate(data);


    return await WarehouseImportSettingsRepository
      .update(
        warehouseId,
        data
      );

  },


  validate(data) {


    const allowedModes = [
      "FIXED",
      "FROM_FILE"
    ];


    if (
      data.brandMode &&
      !allowedModes.includes(
        data.brandMode
      )
    ) {

      throw new Error(
        "Неверный режим бренда"
      );

    }


    const columns = [
      "brandColumn",
      "articleColumn",
      "nameColumn",
      "priceColumn",
      "quantityColumn"
    ];


    for (const column of columns) {

      if (
        data[column] !== undefined &&
        data[column] !== null &&
        data[column] < 1
      ) {

        throw new Error(
          `Номер колонки ${column} должен быть больше 0`
        );

      }

    }


    if (
      data.brandMode === "FIXED" &&
      !data.fixedBrandId
    ) {

      throw new Error(
        "Для фиксированного бренда нужно указать бренд"
      );

    }

  }


};