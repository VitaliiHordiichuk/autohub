import { pool } from "../config/db.js";

import {
  normalizeBrandAlias,
} from "../repositories/BrandAliasRepository.js";


function positiveId(
  value,
  fieldName
) {
  const id = Number(value);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    throw new Error(
      `${fieldName}: некорректный номер`
    );
  }

  return id;
}


function normalizeName(value) {
  const name = String(
    value ?? ""
  )
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");

  if (!name) {
    throw new Error(
      "Название бренда обязательно"
    );
  }

  if (name.length > 100) {
    throw new Error(
      "Название бренда не должно превышать 100 символов"
    );
  }

  return name;
}


function normalizeAliasText(value) {
  const alias = String(
    value ?? ""
  )
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");

  if (!alias) {
    throw new Error(
      "Вариант написания обязателен"
    );
  }

  if (alias.length > 150) {
    throw new Error(
      "Вариант написания не должен превышать 150 символов"
    );
  }

  const aliasNormalized =
    normalizeBrandAlias(alias);

  if (!aliasNormalized) {
    throw new Error(
      "Вариант написания не содержит букв или цифр"
    );
  }

  return {
    alias,
    aliasNormalized,
  };
}


function normalizeBoolean(
  value,
  fieldName,
  {
    optional = false,
  } = {}
) {
  if (
    optional &&
    value === undefined
  ) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(
      `${fieldName} должно быть true или false`
    );
  }

  return value;
}


async function getBrandRow(
  db,
  brandId
) {
  const result =
    await db.query(
      `
        SELECT
          b.id,
          b.name,
          b.is_active,
          b.updated_at,
          COUNT(DISTINCT p.id)::integer
            AS products_count

        FROM brands AS b

        LEFT JOIN products AS p
          ON p.brand_id = b.id

        WHERE b.id = $1

        GROUP BY
          b.id,
          b.name,
          b.is_active,
          b.updated_at

        LIMIT 1
      `,
      [
        brandId,
      ]
    );

  return result.rows[0] ?? null;
}


async function getAliases(
  db,
  brandId
) {
  const result =
    await db.query(
      `
        SELECT
          id,
          brand_id,
          alias,
          alias_normalized,
          is_primary,
          is_active,
          created_at,
          updated_at

        FROM brand_aliases

        WHERE brand_id = $1

        ORDER BY
          is_primary DESC,
          LOWER(alias),
          id
      `,
      [
        brandId,
      ]
    );

  return result.rows;
}


function mapBrand(
  brand,
  aliases
) {
  return {
    id:
      Number(brand.id),

    name:
      brand.name,

    isActive:
      brand.is_active === true,

    productsCount:
      Number(
        brand.products_count ?? 0
      ),

    updatedAt:
      brand.updated_at,

    aliases:
      aliases.map(
        (alias) => ({
          id:
            Number(alias.id),

          brandId:
            Number(alias.brand_id),

          alias:
            alias.alias,

          aliasNormalized:
            alias.alias_normalized,

          isPrimary:
            alias.is_primary === true,

          isActive:
            alias.is_active === true,

          createdAt:
            alias.created_at,

          updatedAt:
            alias.updated_at,
        })
      ),
  };
}


async function getBrand(
  db,
  brandId
) {
  const brand =
    await getBrandRow(
      db,
      brandId
    );

  if (!brand) {
    throw new Error(
      "Бренд не найден"
    );
  }

  const aliases =
    await getAliases(
      db,
      brandId
    );

  return mapBrand(
    brand,
    aliases
  );
}


function translateUniqueError(
  error
) {
  if (error?.code !== "23505") {
    throw error;
  }

  if (
    error.constraint ===
    "brands_name_key"
  ) {
    throw new Error(
      "Бренд с таким названием уже существует"
    );
  }

  if (
    error.constraint ===
    "brand_aliases_normalized_unique"
  ) {
    throw new Error(
      "Такой вариант написания уже используется другим брендом"
    );
  }

  throw new Error(
    "Такая запись уже существует"
  );
}


export const BrandAdminService = {

  async getBrands({
    includeInactive = false,
  } = {}) {
    const result =
      await pool.query(
        `
          SELECT
            b.id,
            b.name,
            b.is_active,
            b.updated_at,
            COUNT(DISTINCT p.id)::integer
              AS products_count

          FROM brands AS b

          LEFT JOIN products AS p
            ON p.brand_id = b.id

          WHERE
            $1::boolean = TRUE OR
            b.is_active = TRUE

          GROUP BY
            b.id,
            b.name,
            b.is_active,
            b.updated_at

          ORDER BY
            b.is_active DESC,
            LOWER(b.name),
            b.id
        `,
        [
          includeInactive,
        ]
      );

    const brands = [];

    for (
      const row of
      result.rows
    ) {
      const aliases =
        await getAliases(
          pool,
          Number(row.id)
        );

      brands.push(
        mapBrand(
          row,
          aliases
        )
      );
    }

    return brands;
  },


  async getBrand(
    brandIdValue
  ) {
    const brandId =
      positiveId(
        brandIdValue,
        "Бренд"
      );

    return await getBrand(
      pool,
      brandId
    );
  },


  async createBrand(
    data = {}
  ) {
    const name =
      normalizeName(
        data.name
      );

    const additionalAliases =
      Array.isArray(data.aliases)
        ? data.aliases
        : [];

    const db =
      await pool.connect();

    try {
      await db.query(
        "BEGIN"
      );

      const brandResult =
        await db.query(
          `
            INSERT INTO brands (
              name,
              is_active,
              updated_at
            )

            VALUES (
              $1,
              TRUE,
              CURRENT_TIMESTAMP
            )

            RETURNING *
          `,
          [
            name,
          ]
        );

      const brandId =
        Number(
          brandResult.rows[0].id
        );

      const primary =
        normalizeAliasText(name);

      await db.query(
        `
          INSERT INTO brand_aliases (
            brand_id,
            alias,
            alias_normalized,
            is_primary,
            is_active
          )

          VALUES (
            $1,$2,$3,TRUE,TRUE
          )
        `,
        [
          brandId,
          primary.alias,
          primary.aliasNormalized,
        ]
      );

      const seen =
        new Set([
          primary.aliasNormalized,
        ]);

      for (
        const aliasValue of
        additionalAliases
      ) {
        const alias =
          normalizeAliasText(
            aliasValue
          );

        if (
          seen.has(
            alias.aliasNormalized
          )
        ) {
          continue;
        }

        seen.add(
          alias.aliasNormalized
        );

        await db.query(
          `
            INSERT INTO brand_aliases (
              brand_id,
              alias,
              alias_normalized,
              is_primary,
              is_active
            )

            VALUES (
              $1,$2,$3,FALSE,TRUE
            )
          `,
          [
            brandId,
            alias.alias,
            alias.aliasNormalized,
          ]
        );
      }

      await db.query(
        "COMMIT"
      );

      return await this.getBrand(
        brandId
      );
    } catch(error) {
      await db.query(
        "ROLLBACK"
      );

      translateUniqueError(
        error
      );
    } finally {
      db.release();
    }
  },


  async updateBrand(
    brandIdValue,
    data = {}
  ) {
    const brandId =
      positiveId(
        brandIdValue,
        "Бренд"
      );

    const hasName =
      data.name !== undefined;

    const hasIsActive =
      data.isActive !== undefined;

    if (
      !hasName &&
      !hasIsActive
    ) {
      throw new Error(
        "Нет данных для изменения бренда"
      );
    }

    const name =
      hasName
        ? normalizeName(
            data.name
          )
        : null;

    const isActive =
      hasIsActive
        ? normalizeBoolean(
            data.isActive,
            "isActive"
          )
        : null;

    const db =
      await pool.connect();

    try {
      await db.query(
        "BEGIN"
      );

      const existing =
        await getBrandRow(
          db,
          brandId
        );

      if (!existing) {
        throw new Error(
          "Бренд не найден"
        );
      }

      if (hasName) {
        const primary =
          normalizeAliasText(
            name
          );

        await db.query(
          `
            UPDATE brands

            SET
              name = $2,
              updated_at =
                CURRENT_TIMESTAMP

            WHERE id = $1
          `,
          [
            brandId,
            name,
          ]
        );

        const primaryResult =
          await db.query(
            `
              UPDATE brand_aliases

              SET
                alias = $2,
                alias_normalized = $3,
                is_active = TRUE,
                updated_at =
                  CURRENT_TIMESTAMP

              WHERE brand_id = $1
                AND is_primary = TRUE

              RETURNING id
            `,
            [
              brandId,
              primary.alias,
              primary.aliasNormalized,
            ]
          );

        if (
          primaryResult.rowCount === 0
        ) {
          await db.query(
            `
              INSERT INTO brand_aliases (
                brand_id,
                alias,
                alias_normalized,
                is_primary,
                is_active
              )

              VALUES (
                $1,$2,$3,TRUE,TRUE
              )
            `,
            [
              brandId,
              primary.alias,
              primary.aliasNormalized,
            ]
          );
        }
      }

      if (hasIsActive) {
        await db.query(
          `
            UPDATE brands

            SET
              is_active = $2,
              updated_at =
                CURRENT_TIMESTAMP

            WHERE id = $1
          `,
          [
            brandId,
            isActive,
          ]
        );
      }

      await db.query(
        "COMMIT"
      );

      return await this.getBrand(
        brandId
      );
    } catch(error) {
      await db.query(
        "ROLLBACK"
      );

      translateUniqueError(
        error
      );
    } finally {
      db.release();
    }
  },


  async addAlias(
    brandIdValue,
    data = {}
  ) {
    const brandId =
      positiveId(
        brandIdValue,
        "Бренд"
      );

    const alias =
      normalizeAliasText(
        data.alias
      );

    try {
      const brand =
        await getBrandRow(
          pool,
          brandId
        );

      if (!brand) {
        throw new Error(
          "Бренд не найден"
        );
      }

      const result =
        await pool.query(
          `
            INSERT INTO brand_aliases (
              brand_id,
              alias,
              alias_normalized,
              is_primary,
              is_active
            )

            VALUES (
              $1,$2,$3,FALSE,TRUE
            )

            RETURNING *
          `,
          [
            brandId,
            alias.alias,
            alias.aliasNormalized,
          ]
        );

      return result.rows[0];
    } catch(error) {
      translateUniqueError(
        error
      );
    }
  },


  async updateAlias(
    brandIdValue,
    aliasIdValue,
    data = {}
  ) {
    const brandId =
      positiveId(
        brandIdValue,
        "Бренд"
      );

    const aliasId =
      positiveId(
        aliasIdValue,
        "Вариант написания"
      );

    const hasAlias =
      data.alias !== undefined;

    const hasIsActive =
      data.isActive !== undefined;

    if (
      !hasAlias &&
      !hasIsActive
    ) {
      throw new Error(
        "Нет данных для изменения варианта написания"
      );
    }

    const existingResult =
      await pool.query(
        `
          SELECT *
          FROM brand_aliases
          WHERE id = $1
            AND brand_id = $2
          LIMIT 1
        `,
        [
          aliasId,
          brandId,
        ]
      );

    const existing =
      existingResult.rows[0];

    if (!existing) {
      throw new Error(
        "Вариант написания не найден"
      );
    }

    if (
      existing.is_primary === true
    ) {
      throw new Error(
        "Основное название меняется через редактирование бренда"
      );
    }

    const alias =
      hasAlias
        ? normalizeAliasText(
            data.alias
          )
        : null;

    const isActive =
      hasIsActive
        ? normalizeBoolean(
            data.isActive,
            "isActive"
          )
        : null;

    try {
      const result =
        await pool.query(
          `
            UPDATE brand_aliases

            SET
              alias =
                COALESCE($3, alias),

              alias_normalized =
                COALESCE(
                  $4,
                  alias_normalized
                ),

              is_active =
                COALESCE(
                  $5,
                  is_active
                ),

              updated_at =
                CURRENT_TIMESTAMP

            WHERE id = $1
              AND brand_id = $2

            RETURNING *
          `,
          [
            aliasId,
            brandId,
            alias?.alias ?? null,
            alias?.aliasNormalized ??
              null,
            isActive,
          ]
        );

      return result.rows[0];
    } catch(error) {
      translateUniqueError(
        error
      );
    }
  },


  async deleteAlias(
    brandIdValue,
    aliasIdValue
  ) {
    const brandId =
      positiveId(
        brandIdValue,
        "Бренд"
      );

    const aliasId =
      positiveId(
        aliasIdValue,
        "Вариант написания"
      );

    const result =
      await pool.query(
        `
          DELETE FROM brand_aliases

          WHERE id = $1
            AND brand_id = $2
            AND is_primary = FALSE

          RETURNING *
        `,
        [
          aliasId,
          brandId,
        ]
      );

    if (
      result.rowCount === 0
    ) {
      throw new Error(
        "Вариант написания не найден или является основным названием"
      );
    }

    return result.rows[0];
  },

  async deleteBrand(
    brandIdValue
  ) {
    const brandId =
      positiveId(
        brandIdValue,
        "Бренд"
      );

    const db =
      await pool.connect();

    try {
      await db.query(
        "BEGIN"
      );

      const brandResult =
        await db.query(
          `
            SELECT
              id,
              name

            FROM brands

            WHERE id = $1

            FOR UPDATE
          `,
          [
            brandId,
          ]
        );

      const brand =
        brandResult.rows[0];

      if (!brand) {
        throw new Error(
          "Бренд не найден"
        );
      }

      const productsResult =
        await db.query(
          `
            SELECT
              COUNT(*)::integer
                AS count

            FROM products

            WHERE brand_id = $1
          `,
          [
            brandId,
          ]
        );

      const productsCount =
        Number(
          productsResult.rows[0]
            ?.count ?? 0
        );

      if (productsCount > 0) {
        throw new Error(
          `Нельзя удалить бренд: к нему привязано товаров — ${productsCount}`
        );
      }

      const settingsResult =
        await db.query(
          `
            SELECT
              COUNT(*)::integer
                AS count

            FROM supplier_import_settings

            WHERE fixed_brand_id = $1
          `,
          [
            brandId,
          ]
        );

      const settingsCount =
        Number(
          settingsResult.rows[0]
            ?.count ?? 0
        );

      if (settingsCount > 0) {
        throw new Error(
          "Нельзя удалить бренд: он выбран в настройках импорта прайса"
        );
      }

      await db.query(
        `
          DELETE FROM brands
          WHERE id = $1
        `,
        [
          brandId,
        ]
      );

      await db.query(
        "COMMIT"
      );

      return {
        id:
          Number(brand.id),

        name:
          brand.name,
      };
    } catch(error) {
      await db.query(
        "ROLLBACK"
      );

      if (
        error?.code === "23503"
      ) {
        throw new Error(
          "Нельзя удалить бренд: он используется в других данных"
        );
      }

      throw error;
    } finally {
      db.release();
    }
  },


};
