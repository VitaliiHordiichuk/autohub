import { pool } from "../config/db.js";


export const GoogleMerchantFeedRepository = {
  async findCandidates(
    db = pool,
    { productIds = null } = {}
  ) {
    const normalizedProductIds = Array.isArray(productIds)
      ? [...new Set(productIds
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0))]
      : null;
    const result = await db.query(`
      SELECT
        p.id AS merchant_product_id,
        p.article AS merchant_article,
        COALESCE(
          uk_translation.name,
          default_translation.name,
          p.name
        ) AS merchant_name,
        CASE
          WHEN uk_translation.name IS NOT NULL
          THEN uk_translation.provider
          WHEN default_translation.name IS NOT NULL
          THEN default_translation.provider
          WHEN EXISTS (
            SELECT 1
            FROM product_translations manual_name
            WHERE manual_name.product_id = p.id
              AND manual_name.provider = 'MANUAL'
              AND manual_name.name = p.name
          )
          THEN 'MANUAL'
          ELSE NULL
        END AS merchant_name_provider,
        uk_translation.description AS merchant_description,
        COALESCE(b.name, pm.name) AS merchant_brand,
        pt.name AS merchant_product_type,
        categories.merchant_categories,
        images.image_urls AS merchant_image_urls,

        po.id,
        po.product_id,
        po.warehouse_id,
        po.supplier_id,
        COALESCE(po.supplier_id, w.supplier_id) AS effective_supplier_id,
        GREATEST(
          po.quantity - COALESCE(reservations.reserved_quantity, 0),
          0
        ) AS quantity,
        po.retail_price AS automatic_retail_price,
        po.manual_retail_price,
        po.minimum_sale_price,
        po.price_mode,
        CASE
          WHEN po.price_mode = 'MANUAL'
            AND po.manual_retail_price IS NOT NULL
          THEN po.manual_retail_price
          ELSE po.retail_price
        END AS retail_price,
        po.delivery_days,
        po.source_type,
        po.is_available,
        po.is_hidden,
        COALESCE(po.is_returnable, w.returnable_by_default, TRUE) AS is_returnable,
        w.name AS warehouse_name,
        w.city AS warehouse_city,
        w.priority AS warehouse_priority,
        w.is_active AS warehouse_active,
        s.name AS supplier_name,
        s.type AS supplier_type,
        s.is_active AS supplier_active,
        s.warehouse_priority_enabled
      FROM products p
      LEFT JOIN brands b
        ON b.id = p.brand_id
      LEFT JOIN part_manufacturers pm
        ON pm.id = p.manufacturer_id
      LEFT JOIN product_types pt
        ON pt.id = p.product_type_id
      LEFT JOIN product_translations uk_translation
        ON uk_translation.product_id = p.id
        AND uk_translation.language_code = 'uk'
      LEFT JOIN LATERAL (
        SELECT sl.code
        FROM site_languages sl
        WHERE sl.is_public_enabled = TRUE
          AND sl.is_default = TRUE
        ORDER BY sl.sort_order, sl.code
        LIMIT 1
      ) default_language ON TRUE
      LEFT JOIN product_translations default_translation
        ON default_translation.product_id = p.id
        AND default_translation.language_code = default_language.code
      LEFT JOIN LATERAL (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', category.id,
            'slug', category.slug,
            'name', category.name,
            'name_uk', category.name_uk,
            'parent_slug', parent.slug,
            'parent_name', parent.name,
            'parent_name_uk', parent.name_uk,
            'assignment_source', assignment.assignment_source,
            'confidence', assignment.confidence
          )
          ORDER BY
            CASE WHEN assignment.assignment_source = 'MANUAL' THEN 0 ELSE 1 END,
            CASE WHEN category.parent_id IS NOT NULL THEN 0 ELSE 1 END,
            assignment.confidence DESC NULLS LAST,
            category.sort_order,
            category.id
        ) AS merchant_categories
        FROM product_categories assignment
        JOIN categories category
          ON category.id = assignment.category_id
          AND category.is_active = TRUE
        LEFT JOIN categories parent
          ON parent.id = category.parent_id
          AND parent.is_active = TRUE
        WHERE assignment.product_id = p.id
      ) categories ON TRUE
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(
          CASE
            WHEN pi.processing_status = 'PROCESSED'
            THEN COALESCE(pi.processed_url_1600, pi.url, pi.original_url)
            ELSE COALESCE(pi.original_url, pi.url)
          END
          ORDER BY pi.priority, pi.id
        ) AS image_urls
        FROM product_images pi
        WHERE pi.product_id = p.id
      ) images ON TRUE
      JOIN product_offers po
        ON po.product_id = p.id
      LEFT JOIN warehouses w
        ON w.id = po.warehouse_id
      LEFT JOIN suppliers s
        ON s.id = COALESCE(po.supplier_id, w.supplier_id)
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(sr.quantity), 0) AS reserved_quantity
        FROM stock_reservations sr
        WHERE sr.product_offer_id = po.id
          AND (
            sr.status = 'ORDER_PENDING'
            OR (
              sr.status = 'ACTIVE'
              AND (
                sr.order_id IS NOT NULL
                OR sr.reserved_until IS NULL
                OR sr.reserved_until > CURRENT_TIMESTAMP
              )
            )
          )
      ) reservations ON TRUE
      WHERE p.is_active = TRUE
        AND ($1::bigint[] IS NULL OR p.id = ANY($1::bigint[]))
        AND NULLIF(BTRIM(p.article), '') IS NOT NULL
        AND NULLIF(BTRIM(COALESCE(b.name, pm.name)), '') IS NOT NULL
        AND (p.brand_id IS NULL OR b.is_active = TRUE)
        AND po.is_available = TRUE
        AND po.is_hidden = FALSE
        AND GREATEST(
          po.quantity - COALESCE(reservations.reserved_quantity, 0),
          0
        ) > 0
        AND (
          CASE
            WHEN po.price_mode = 'MANUAL'
              AND po.manual_retail_price IS NOT NULL
            THEN po.manual_retail_price
            ELSE po.retail_price
          END
        ) > 0
        AND (w.id IS NULL OR w.is_active = TRUE)
        AND (s.id IS NULL OR s.is_active = TRUE)
      ORDER BY
        p.id,
        CASE
          WHEN s.type = 'OWN'
            OR (s.id IS NULL AND po.source_type = 'OWN_STOCK')
          THEN 1
          ELSE 2
        END,
        s.name NULLS FIRST,
        w.priority ASC NULLS LAST,
        retail_price ASC NULLS LAST,
        po.id
    `, [normalizedProductIds]);

    return result.rows;
  },
};
