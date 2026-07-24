AUTOHUB — УПРАВЛЕНИЕ ПОЗИЦИЯМИ СКЛАДА

Файлы:
- src/repositories/AdminWarehouseOfferRepository.js
- src/services/AdminWarehouseOfferService.js
- src/controllers/admin-warehouse-offer.controller.js
- src/routes/admin-warehouse-offer.routes.js

Добавить в src/app.js:

1. Импорт:

import { adminWarehouseOfferRouter }
from "./routes/admin-warehouse-offer.routes.js";

2. Маршрут:

app.use(
  "/api/admin/warehouses",
  adminWarehouseOfferRouter
);

API:

GET
/api/admin/warehouses/:warehouseId/offers

Параметры:
search=
status=ALL|ACTIVE|HIDDEN|IN_STOCK|OUT_OF_STOCK|MANUAL
page=1
limit=50

PATCH
/api/admin/warehouses/:warehouseId/offers/:offerId/manual-price

JSON:
{
  "price": 1250
}

DELETE
/api/admin/warehouses/:warehouseId/offers/:offerId/manual-price

PATCH
/api/admin/warehouses/:warehouseId/offers/:offerId/visibility

JSON:
{
  "hidden": true
}

GET
/api/admin/warehouses/:warehouseId/offers/:offerId/price-history

Примечание:
changedBy пока необязателен. После подключения авторизации
ID пользователя будет браться из req.user.id.
