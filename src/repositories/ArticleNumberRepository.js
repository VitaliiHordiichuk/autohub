import {
  pool,
} from "../config/db.js";


function mapLink(row) {
  return {
    id: Number(row.id),
    linkType: row.link_type,
    sourceBrandId:
      Number(row.source_brand_id),
    sourceBrandName:
      row.source_brand_name,
    sourceArticle:
      row.source_article,
    sourceArticleNormalized:
      row.source_article_normalized,
    targetBrandId:
      Number(row.target_brand_id),
    targetBrandName:
      row.target_brand_name,
    targetArticle:
      row.target_article,
    targetArticleNormalized:
      row.target_article_normalized,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}


function searchProductSql(whereSql) {
  return `
    SELECT
      p.id,
      p.brand_id,
      p.article,
      p.article_normalized,
      p.name,
      p.article_base,
      p.article_suffix,
      p.article_suffix_length,
      p.variant_type,
      b.name AS brand_name,
      vb.name AS vehicle_brand,
      COALESCE(
        b.name,
        pm.name
      ) AS manufacturer,
      pt.name AS product_type
    FROM products p
    LEFT JOIN brands b
      ON b.id = p.brand_id
    LEFT JOIN vehicle_brands vb
      ON vb.id = p.vehicle_brand_id
    LEFT JOIN part_manufacturers pm
      ON pm.id = p.manufacturer_id
    LEFT JOIN product_types pt
      ON pt.id = p.product_type_id
    WHERE
      p.is_active = TRUE
      AND ${whereSql}
  `;
}


export const ArticleNumberRepository = {
  async listLinks({
    search = "",
    linkType = null,
    includeInactive = true,
    db = pool,
  } = {}) {
    const result = await db.query(
      `
        SELECT l.*,
          source_brand.name AS source_brand_name,
          target_brand.name AS target_brand_name
        FROM article_number_links l
        JOIN brands source_brand ON source_brand.id = l.source_brand_id
        JOIN brands target_brand ON target_brand.id = l.target_brand_id
        WHERE ($1::varchar IS NULL OR l.link_type = $1::varchar)
          AND ($2::boolean OR l.is_active = TRUE)
          AND (
            $3::text = '' OR
            l.source_article_normalized ILIKE '%' || $3::text || '%' OR
            l.target_article_normalized ILIKE '%' || $3::text || '%' OR
            source_brand.name ILIKE '%' || $3::text || '%' OR
            target_brand.name ILIKE '%' || $3::text || '%'
          )
        ORDER BY l.is_active DESC, l.updated_at DESC, l.id DESC
        LIMIT 500;
      `,
      [linkType, includeInactive, search]
    );

    return result.rows.map(mapLink);
  },

  async createLink({
    linkType,
    sourceBrandId,
    sourceArticle,
    sourceArticleNormalized,
    targetBrandId,
    targetArticle,
    targetArticleNormalized,
    db = pool,
  }) {
    const result = await db.query(
      `
        INSERT INTO article_number_links (
          link_type, source_brand_id, source_article,
          source_article_normalized, target_brand_id,
          target_article, target_article_normalized
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (
          link_type, source_brand_id, source_article_normalized,
          target_brand_id, target_article_normalized
        ) DO UPDATE SET
          source_article = EXCLUDED.source_article,
          target_article = EXCLUDED.target_article,
          is_active = TRUE,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `,
      [linkType, sourceBrandId, sourceArticle, sourceArticleNormalized,
        targetBrandId, targetArticle, targetArticleNormalized]
    );

    const row = result.rows[0];
    const sourceBrand = await this.findBrandById(sourceBrandId, db);
    const targetBrand = await this.findBrandById(targetBrandId, db);
    return mapLink({
      ...row,
      source_brand_name: sourceBrand?.name,
      target_brand_name: targetBrand?.name,
    });
  },

  async setLinkActive({ id, isActive, db = pool }) {
    const result = await db.query(
      `UPDATE article_number_links
       SET is_active = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *;`,
      [id, isActive]
    );
    return result.rows[0] ?? null;
  },
  async findOutgoing({
    brandId = null,
    articleNormalized,
    linkTypes = [
      "ALIAS",
      "REPLACEMENT",
    ],
    db = pool,
  }) {
    const result = await db.query(
      `
        SELECT
          l.*,
          source_brand.name
            AS source_brand_name,
          target_brand.name
            AS target_brand_name
        FROM article_number_links l
        JOIN brands source_brand
          ON source_brand.id =
            l.source_brand_id
        JOIN brands target_brand
          ON target_brand.id =
            l.target_brand_id
        WHERE
          l.is_active = TRUE
          AND l.source_article_normalized = $1
          AND (
            $2::integer IS NULL
            OR l.source_brand_id = $2::integer
          )
          AND l.link_type =
            ANY($3::varchar[])
        ORDER BY
          CASE l.link_type
            WHEN 'REPLACEMENT' THEN 1
            WHEN 'ALIAS' THEN 2
            ELSE 3
          END,
          l.id;
      `,
      [
        articleNormalized,
        brandId,
        linkTypes,
      ]
    );

    return result.rows.map(mapLink);
  },


  async findIncomingReplacements({
    brandId = null,
    articleNormalized,
    db = pool,
  }) {
    const result = await db.query(
      `
        SELECT
          l.*,
          source_brand.name
            AS source_brand_name,
          target_brand.name
            AS target_brand_name
        FROM article_number_links l
        JOIN brands source_brand
          ON source_brand.id =
            l.source_brand_id
        JOIN brands target_brand
          ON target_brand.id =
            l.target_brand_id
        WHERE
          l.is_active = TRUE
          AND l.link_type = 'REPLACEMENT'
          AND l.target_article_normalized = $1
          AND (
            $2::integer IS NULL
            OR l.target_brand_id = $2::integer
          )
        ORDER BY l.id;
      `,
      [
        articleNormalized,
        brandId,
      ]
    );

    return result.rows.map(mapLink);
  },


  async findBrandById(
    brandId,
    db = pool
  ) {
    const result = await db.query(
      `
        SELECT id, name, is_active
        FROM brands
        WHERE id = $1
        LIMIT 1;
      `,
      [brandId]
    );

    return result.rows[0] ?? null;
  },


  async findProductByBrandAndArticle({
    brandId,
    articleNormalized,
    db = pool,
  }) {
    const result = await db.query(
      `
        SELECT *
        FROM products
        WHERE brand_id = $1
          AND article_normalized = $2
        LIMIT 1;
      `,
      [
        brandId,
        articleNormalized,
      ]
    );

    return result.rows[0] ?? null;
  },


  async findSearchProductByBrandAndArticle({
    brandId,
    articleNormalized,
    db = pool,
  }) {
    const result = await db.query(
      `${searchProductSql(
        "p.brand_id = $1 AND p.article_normalized = $2"
      )}
       LIMIT 1;`,
      [
        brandId,
        articleNormalized,
      ]
    );

    return result.rows[0] ?? null;
  },


  async findSearchProductsByArticle({
    articleNormalized,
    db = pool,
  }) {
    const result = await db.query(
      `${searchProductSql(
        "p.article_normalized = $1"
      )}
       ORDER BY p.id
       LIMIT 50;`,
      [articleNormalized]
    );

    return result.rows;
  },

  async findSearchProductsByPrefixes({
    articlePrefixes,
    db = pool,
  }) {
    const prefixes = [...new Set(
      (articlePrefixes || [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )];

    if (prefixes.length === 0) return [];

    const result = await db.query(
      `${searchProductSql(`
        EXISTS (
          SELECT 1
          FROM unnest($1::text[]) AS prefix(value)
          WHERE p.article_normalized LIKE prefix.value || '%'
        )
      `)}
       ORDER BY LENGTH(p.article_normalized), p.article_normalized, p.id
       LIMIT 50;`,
      [prefixes]
    );

    return result.rows;
  },


  async promoteProductArticle({
    productId,
    brandId,
    article,
    articleNormalized,
    articleNoPrefix,
    articleBase,
    articleSuffix,
    articleSuffixLength,
    variantType,
    db = pool,
  }) {
    const result = await db.query(
      `
        UPDATE products
        SET
          brand_id = $2,
          article = $3,
          article_normalized = $4,
          article_no_prefix = $5,
          article_base = $6,
          article_suffix = $7,
          article_suffix_length = $8,
          variant_type = $9,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
      `,
      [
        productId,
        brandId,
        article,
        articleNormalized,
        articleNoPrefix,
        articleBase,
        articleSuffix,
        articleSuffixLength,
        variantType,
      ]
    );

    return result.rows[0] ?? null;
  },
};
