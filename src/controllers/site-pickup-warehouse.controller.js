import {
  WarehouseRepository,
} from "../repositories/WarehouseRepository.js";

export async function listPickupWarehouses(
  req,
  res
) {
  try {
    const rows =
      await WarehouseRepository
        .findPickupAvailable();

    const warehouses =
      rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        city: row.city ?? null,
        type: row.type ?? null,
        deliveryDays:
          Number(row.delivery_days || 0),
      }));

    return res.json({
      success: true,
      warehouses,
    });
  } catch (error) {
    console.error(
      "Ошибка получения точек самовывоза:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Не удалось получить точки самовывоза",
    });
  }
}
