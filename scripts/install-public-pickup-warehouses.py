from pathlib import Path
import shutil

repository_path = Path(
    "src/repositories/WarehouseRepository.js"
)
app_path = Path("src/app.js")

for path in [repository_path, app_path]:
    if not path.exists():
        raise SystemExit(
            f"Не найден файл: {path}. "
            "Запускайте установщик из ~/autohub-backend"
        )

for path in [repository_path, app_path]:
    backup = path.with_suffix(
        path.suffix +
        ".backup-before-public-pickup"
    )
    if not backup.exists():
        shutil.copy2(path, backup)

repository_text = repository_path.read_text(
    encoding="utf-8"
)

method_marker = """  async findById(
    warehouseId,
    db = pool
  ) {"""

new_method = """  async findPickupAvailable(
    db = pool
  ) {
    const sql = `
      SELECT
        id,
        name,
        city,
        type,
        delivery_days
      FROM warehouses
      WHERE is_active = TRUE
        AND (
          pickup_available = TRUE
          OR type = 'OWN'
        )
      ORDER BY
        CASE
          WHEN type = 'OWN' THEN 0
          ELSE 1
        END,
        city NULLS LAST,
        name;
    `;

    const result =
      await db.query(sql);

    return result.rows;
  },

  async findById(
    warehouseId,
    db = pool
  ) {"""

if "async findPickupAvailable(" not in repository_text:
    if repository_text.count(method_marker) != 1:
        raise SystemExit(
            "Не найдено место для метода "
            "findPickupAvailable"
        )
    repository_text = repository_text.replace(
        method_marker,
        new_method,
        1,
    )

repository_path.write_text(
    repository_text,
    encoding="utf-8",
)

app_text = app_path.read_text(
    encoding="utf-8"
)

import_anchor = """import {
  siteLanguageRouter,
  adminSiteLanguageRouter,
} from "./routes/site-language.routes.js";
"""

import_insert = """import {
  siteLanguageRouter,
  adminSiteLanguageRouter,
} from "./routes/site-language.routes.js";

import {
  sitePickupWarehouseRouter,
} from "./routes/site-pickup-warehouse.routes.js";
"""

if "sitePickupWarehouseRouter" not in app_text:
    if app_text.count(import_anchor) != 1:
        raise SystemExit(
            "Не найдено место для импорта "
            "sitePickupWarehouseRouter"
        )
    app_text = app_text.replace(
        import_anchor,
        import_insert,
        1,
    )

route_anchor = """app.use(
  "/api/site/languages",
  siteLanguageRouter
);
"""

route_insert = """app.use(
  "/api/site/languages",
  siteLanguageRouter
);

app.use(
  "/api/site/pickup-warehouses",
  sitePickupWarehouseRouter
);
"""

if '"/api/site/pickup-warehouses"' not in app_text:
    if app_text.count(route_anchor) != 1:
        raise SystemExit(
            "Не найдено место для публичного "
            "маршрута складов"
        )
    app_text = app_text.replace(
        route_anchor,
        route_insert,
        1,
    )

app_path.write_text(
    app_text,
    encoding="utf-8",
)

print(
    "Публичный список точек самовывоза подключён"
)
