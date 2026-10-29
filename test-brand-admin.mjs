import {
  BrandAdminService,
} from "./src/services/BrandAdminService.js";

import {
  BrandAliasRepository,
} from "./src/repositories/BrandAliasRepository.js";

import {
  pool,
} from "./src/config/db.js";

let brandId = null;

try {
  const suffix =
    String(Date.now()).slice(-8);

  const brandName =
    `AND TEST ${suffix}`;

  const alias =
    `A.N.D. ${suffix}`;

  const searchAlias =
    `a n d ${suffix}`;

  const created =
    await BrandAdminService
      .createBrand({
        name: brandName,
        aliases: [
          alias,
        ],
      });

  brandId = created.id;

  console.log(
    "Создан бренд:",
    created.name
  );

  console.log(
    "Варианты:",
    created.aliases.map(
      (item) => item.alias
    )
  );

  const found =
    await BrandAliasRepository
      .findByAlias(
        searchAlias
      );

  console.log(
    "Распознано:",
    searchAlias,
    "→",
    found?.brand_name ||
      "НЕ НАЙДЕН"
  );

  if (
    found?.brand_name !==
    brandName
  ) {
    throw new Error(
      "Вариант написания не распознан"
    );
  }

  const disabled =
    await BrandAdminService
      .updateBrand(
        brandId,
        {
          isActive: false,
        }
      );

  console.log(
    "Бренд отключён:",
    disabled.isActive === false
  );

  const afterDisable =
    await BrandAliasRepository
      .findByAlias(
        searchAlias
      );

  console.log(
    "После отключения:",
    afterDisable
      ? afterDisable.brand_name
      : "НЕ НАЙДЕН"
  );

  if (afterDisable) {
    throw new Error(
      "Отключённый бренд всё ещё распознаётся"
    );
  }

  console.log(
    "\nТЕСТ УСПЕШЕН: управление брендами работает"
  );
} finally {
  if (brandId !== null) {
    await pool.query(
      `
        DELETE FROM brands
        WHERE id = $1
      `,
      [brandId]
    );
  }

  await pool.end();
}
