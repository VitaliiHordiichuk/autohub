import {
  WarehouseImportProfileService,
} from "../services/WarehouseImportProfileService.js";

export async function getWarehouseImportProfile(
  req,
  res
) {
  try {
    const result =
      await WarehouseImportProfileService
        .getProfile(
          req.params.warehouseId
        );

    return res.json({
      success: true,
      ...result,
    });
  } catch(error) {
    console.error(
      "Ошибка получения профиля импорта склада:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function saveWarehouseImportProfile(
  req,
  res
) {
  try {
    const result =
      await WarehouseImportProfileService
        .saveProfile(
          req.params.warehouseId,
          req.body
        );

    return res.json({
      success: true,
      message:
        "Настройки импорта склада сохранены",
      ...result,
    });
  } catch(error) {
    console.error(
      "Ошибка сохранения профиля импорта склада:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
