import {
  pool,
} from "../config/db.js";


function mapTranslation(row) {
  return {
    productId:
      Number(row.product_id),

    languageCode:
      row.language_code,

    name:
      row.name,

    description:
      row.description ?? null,

    provider:
      row.provider,

    sourceLanguage:
      row.source_language ?? null,

    isVerified:
      row.is_verified === true,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  };
}


export const ProductTranslationRepository = {
  async findProductById(
    productId,
    db = pool
  ) {
    const result =
      await db.query(
        `
          SELECT
            id,
            article,
            article_normalized,
            name
          FROM products
          WHERE id = $1
          LIMIT 1;
        `,
        [productId]
      );

    return result.rows[0] ?? null;
  },


  async findLanguageByCode(
    languageCode,
    db = pool
  ) {
    const result =
      await db.query(
        `
          SELECT
            code,
            native_name,
            english_name,
            is_public_enabled,
            is_admin_enabled,
            is_default,
            sort_order
          FROM site_languages
          WHERE code = $1
          LIMIT 1;
        `,
        [languageCode]
      );

    return result.rows[0] ?? null;
  },


  async listLanguagesWithTranslations(
    productId,
    db = pool
  ) {
    const result =
      await db.query(
        `
          SELECT
            sl.code,
            sl.native_name,
            sl.english_name,
            sl.is_public_enabled,
            sl.is_admin_enabled,
            sl.is_default,
            sl.sort_order,

            pt.product_id,
            pt.language_code,
            pt.name,
            pt.description,
            pt.provider,
            pt.source_language,
            pt.is_verified,
            pt.created_at,
            pt.updated_at

          FROM site_languages sl

          LEFT JOIN product_translations pt
            ON pt.language_code = sl.code
            AND pt.product_id = $1

          WHERE
            sl.is_admin_enabled = TRUE

          ORDER BY
            sl.sort_order ASC,
            sl.code ASC;
        `,
        [productId]
      );

    return result.rows.map(
      (row) => ({
        language: {
          code:
            row.code,

          nativeName:
            row.native_name,

          englishName:
            row.english_name,

          isPublicEnabled:
            row.is_public_enabled === true,

          isAdminEnabled:
            row.is_admin_enabled === true,

          isDefault:
            row.is_default === true,

          sortOrder:
            Number(row.sort_order),
        },

        translation:
          row.language_code
            ? mapTranslation(row)
            : null,
      })
    );
  },


  async upsert(
    {
      productId,
      languageCode,
      name,
      description,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          INSERT INTO product_translations (
            product_id,
            language_code,
            name,
            description,
            provider,
            source_language,
            is_verified
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            'MANUAL',
            $2,
            TRUE
          )

          ON CONFLICT (
            product_id,
            language_code
          )
          DO UPDATE SET
            name =
              EXCLUDED.name,

            description =
              EXCLUDED.description,

            provider =
              'MANUAL',

            source_language =
              EXCLUDED.language_code,

            is_verified =
              TRUE,

            updated_at =
              CURRENT_TIMESTAMP

          RETURNING
            product_id,
            language_code,
            name,
            description,
            provider,
            source_language,
            is_verified,
            created_at,
            updated_at;
        `,
        [
          productId,
          languageCode,
          name,
          description,
        ]
      );

    return mapTranslation(
      result.rows[0]
    );
  },
};
