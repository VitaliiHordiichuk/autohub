import { pool } from "../config/db.js";


export function normalizeBrandAlias(
  value
) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ""
    );
}


export const BrandAliasRepository = {

  async findByAlias(
    alias,
    db = pool
  ) {
    const aliasNormalized =
      normalizeBrandAlias(alias);

    if (!aliasNormalized) {
      return null;
    }

    const result =
      await db.query(
        `
          SELECT
            ba.id AS alias_id,
            ba.alias,
            ba.alias_normalized,
            ba.brand_id,
            b.name AS brand_name

          FROM brand_aliases AS ba

          JOIN brands AS b
            ON b.id = ba.brand_id

          WHERE
            ba.alias_normalized = $1
            AND ba.is_active = TRUE
            AND b.is_active = TRUE

          LIMIT 1
        `,
        [
          aliasNormalized,
        ]
      );

    return result.rows[0] ?? null;
  },

};
