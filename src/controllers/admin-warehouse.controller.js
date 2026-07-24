import { WarehouseService } from "../services/WarehouseService.js";

export async function createWarehouse(req, res) {
  try {
    const warehouse =
      await WarehouseService.createWarehouse(
        req.body
      );

    return res.status(201).json({
      success: true,
      message: "Склад создан",
      warehouse,
    });
  } catch (error) {
    console.error("Ошибка создания склада:", error);

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function getWarehouses(req, res) {
  try {
    const warehouses =
      await WarehouseService.getWarehouses({
        type: req.query.type ?? null,
        supplierId:
          req.query.supplierId ?? null,
        includeInactive:
          req.query.includeInactive ?? false,
      });

    return res.json({
      success: true,
      warehouses,
    });
  } catch (error) {
    console.error(
      "Ошибка получения складов:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function getWarehouse(req, res) {
  try {
    const warehouse =
      await WarehouseService.getWarehouse(
        req.params.warehouseId
      );

    return res.json({
      success: true,
      warehouse,
    });
  } catch (error) {
    console.error(
      "Ошибка получения склада:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function updateWarehouse(req, res) {
  try {
    const warehouse =
      await WarehouseService.updateWarehouse(
        req.params.warehouseId,
        req.body
      );

    return res.json({
      success: true,
      message: "Склад обновлён",
      warehouse,
    });
  } catch (error) {
    console.error(
      "Ошибка обновления склада:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function setWarehouseActive(req, res) {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      throw new Error(
        "Поле isActive должно быть true или false"
      );
    }

    const warehouse =
      await WarehouseService.setWarehouseActive(
        req.params.warehouseId,
        isActive
      );

    return res.json({
      success: true,
      message: isActive
        ? "Склад включён"
        : "Склад отключён",
      warehouse,
    });
  } catch (error) {
    console.error(
      "Ошибка изменения активности склада:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}