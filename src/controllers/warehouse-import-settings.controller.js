import { WarehouseImportSettingsService } 
from "../services/WarehouseImportSettingsService.js";


export async function getWarehouseImportSettings(
  req,
  res
) {

  try {

    const settings =
      await WarehouseImportSettingsService.getSettings(
        req.params.warehouseId
      );


    return res.json({
      success: true,
      settings,
    });


  } catch (error) {

    console.error(
      "Ошибка получения настроек импорта:",
      error
    );


    return res.status(400).json({
      success:false,
      error:error.message,
    });

  }

}



export async function createWarehouseImportSettings(
  req,
  res
) {

  try {

    const settings =
      await WarehouseImportSettingsService.createSettings(
        req.params.warehouseId,
        req.body
      );


    return res.status(201).json({
      success:true,
      message:"Настройки импорта созданы",
      settings,
    });


  } catch(error) {

    console.error(
      "Ошибка создания настроек импорта:",
      error
    );


    return res.status(400).json({
      success:false,
      error:error.message,
    });

  }

}




export async function updateWarehouseImportSettings(
  req,
  res
) {

  try {


    const settings =
      await WarehouseImportSettingsService.updateSettings(
        req.params.warehouseId,
        req.body
      );


    return res.json({
      success:true,
      message:"Настройки импорта обновлены",
      settings,
    });


  } catch(error) {


    console.error(
      "Ошибка обновления настроек импорта:",
      error
    );


    return res.status(400).json({
      success:false,
      error:error.message,
    });


  }

}