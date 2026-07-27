import { pool } from "../config/db.js";


function buildListFilters({
  warehouseId,
  search,
  normalizedSearch,
  status,
}) {
  const conditions = [
    "po.warehouse_id = $1",
  ];

  const params = [warehouseId];

  if (search) {
    params.push(`%${search}%`);
    const rawSearchIndex = params.length;

    params.push(
      `%${normalizedSearch || search}%`
    );
    const normalizedSearchIndex =
      params.length;

    conditions.push(`
      (
        p.article ILIKE $${rawSearchIndex}
        OR p.article_normalized
          ILIKE $${normalizedSearchIndex}
        OR p.name ILIKE $${rawSearchIndex}
        OR EXISTS (
          SELECT 1
          FROM product_translations
            pt_search
          WHERE
            pt_search.product_id = p.id
            AND pt_search.name
              ILIKE $${rawSearchIndex}
        )
      )
    `);
  }

  switch (status) {
    case "ACTIVE":
      conditions.push("po.is_hidden = FALSE");
      break;

    case "HIDDEN":
      conditions.push("po.is_hidden = TRUE");
      break;

    case "IN_STOCK":
      conditions.push("po.is_hidden = FALSE");
      conditions.push("po.quantity > 0");
      break;

    case "OUT_OF_STOCK":
      conditions.push("po.is_hidden = FALSE");
      conditions.push("po.quantity <= 0");
      break;

    case "MANUAL":
      conditions.push("po.price_mode = 'MANUAL'");
      break;

    case "ALL":
    default:
      break;
  }

  return {
    whereSql:
      conditions.join("\n AND "),
    params,
  };
}


export const AdminWarehouseOfferRepository = {
  async findWarehouseById(
    warehouseId,
    db = pool
  ) {
    const result = await db.query(
      `
        SELECT
          id,
          name,
          city,
          type,
          supplier_id,
          delivery_days,
          is_active
        FROM warehouses
        WHERE id = $1
        LIMIT 1;
      `,
      [warehouseId]
    );

    return result.rows[0] ?? null;
  },


  async findBrandById(
    brandId,
    db = pool
  ) {
    const result =
      await db.query(
        `
          SELECT
            id,
            name,
            is_active
          FROM brands
          WHERE id = $1
          LIMIT 1;
        `,
        [brandId]
      );

    return result.rows[0] ?? null;
  },


  async findProductByBrandAndArticle(
    {
      brandId,
      articleNormalized,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          SELECT *
          FROM products
          WHERE brand_id = $1
            AND article_normalized = $2
          LIMIT 1
          FOR UPDATE;
        `,
        [
          brandId,
          articleNormalized,
        ]
      );

    return result.rows[0] ?? null;
  },


  async createProduct(
    {
      brandId,
      article,
      articleNormalized,
      name,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          INSERT INTO products (
            brand_id,
            article,
            article_normalized,
            name
          )
          VALUES (
            $1,
            $2,
            $3,
            $4
          )
          RETURNING *;
        `,
        [
          brandId,
          article,
          articleNormalized,
          name,
        ]
      );

    return result.rows[0];
  },


  async findOfferByProductAndWarehouseForUpdate(
    {
      productId,
      warehouseId,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          SELECT *
          FROM product_offers
          WHERE product_id = $1
            AND warehouse_id = $2
          LIMIT 1
          FOR UPDATE;
        `,
        [
          productId,
          warehouseId,
        ]
      );

    return result.rows[0] ?? null;
  },


  async createManualOffer(
    {
      productId,
      warehouseId,
      supplierId,
      quantity,
      purchasePrice,
      deliveryDays,
      sourceType,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          INSERT INTO product_offers (
            product_id,
            warehouse_id,
            supplier_id,
            quantity,
            purchase_price,
            delivery_days,
            source_type,
            is_available,
            is_hidden,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            ($4::numeric > 0),
            FALSE,
            CURRENT_TIMESTAMP
          )
          RETURNING *;
        `,
        [
          productId,
          warehouseId,
          supplierId,
          quantity,
          purchasePrice,
          deliveryDays,
          sourceType,
        ]
      );

    return result.rows[0];
  },


  async updateManualOffer(
    {
      offerId,
      supplierId,
      quantity,
      purchasePrice,
      deliveryDays,
      sourceType,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          UPDATE product_offers
          SET
            supplier_id = $2,
            quantity = $3,
            purchase_price = $4,
            delivery_days = $5,
            source_type = $6,
            is_available =
              ($3::numeric > 0),
            updated_at =
              CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *;
        `,
        [
          offerId,
          supplierId,
          quantity,
          purchasePrice,
          deliveryDays,
          sourceType,
        ]
      );

    return result.rows[0] ?? null;
  },


  async removeUntilNextImport(
    offerId,
    db = pool
  ) {
    const result =
      await db.query(
        `
          UPDATE product_offers
          SET
            quantity = 0,
            is_available = FALSE,
            updated_at =
              CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *;
        `,
        [offerId]
      );

    return result.rows[0] ?? null;
  },


  async listByWarehouseId(
    {
      warehouseId,
      search,
      normalizedSearch,
      status,
      locale,
      page,
      limit,
    },
    db = pool
  ) {
    const {
      whereSql,
      params,
    } = buildListFilters({
      warehouseId,
      search,
      normalizedSearch,
      status,
    });

    const offset =
      (page - 1) * limit;

    const countResult =
      await db.query(
        `
          SELECT COUNT(*)::integer AS total
          FROM product_offers po

          JOIN products p
            ON p.id = po.product_id

          WHERE ${whereSql};
        `,
        params
      );

    const listParams = [
      ...params,
      locale,
      limit,
      offset,
    ];

    const localeIndex =
      listParams.length - 2;

    const limitIndex =
      listParams.length - 1;

    const offsetIndex =
      listParams.length;

    const result =
      await db.query(
        `
          SELECT
            po.id,
            po.product_id,
            po.warehouse_id,
            po.supplier_id,

            p.article,
            p.article_normalized,

            p.name
              AS source_name,

            COALESCE(
              NULLIF(pt.name, ''),
              p.name
            ) AS localized_name,

            pt.language_code
              AS translation_language_code,

            pm.name AS manufacturer_name,

            w.name AS warehouse_name,
            w.city AS warehouse_city,

            s.name AS supplier_name,

            po.quantity,
            po.purchase_price,

            po.retail_price
              AS automatic_retail_price,

            po.manual_retail_price,
            po.price_mode,

            CASE
              WHEN
                po.price_mode = 'MANUAL'
                AND po.manual_retail_price IS NOT NULL
              THEN po.manual_retail_price

              ELSE po.retail_price
            END AS effective_retail_price,

            po.delivery_days,
            po.source_type,
            po.is_available,
            po.is_hidden,

            po.manual_price_updated_at,
            po.hidden_at,
            po.updated_at

          FROM product_offers po

          JOIN products p
            ON p.id = po.product_id

          LEFT JOIN product_translations pt
            ON pt.product_id = p.id
            AND pt.language_code =
              $${localeIndex}

          LEFT JOIN part_manufacturers pm
            ON pm.id = p.manufacturer_id

          LEFT JOIN warehouses w
            ON w.id = po.warehouse_id

          LEFT JOIN suppliers s
            ON s.id = po.supplier_id

          WHERE ${whereSql}

          ORDER BY
            p.article_normalized,
            po.id

          LIMIT $${limitIndex}
          OFFSET $${offsetIndex};
        `,
        listParams
      );

    return {
      rows: result.rows,
      total:
        countResult.rows[0]?.total ?? 0,
    };
  },


  async findOfferForUpdate(
    {
      warehouseId,
      offerId,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          SELECT
            po.*,

            p.article,
            p.article_normalized,
            p.name,

            CASE
              WHEN
                po.price_mode = 'MANUAL'
                AND po.manual_retail_price IS NOT NULL
              THEN po.manual_retail_price

              ELSE po.retail_price
            END AS effective_retail_price

          FROM product_offers po

          JOIN products p
            ON p.id = po.product_id

          WHERE po.id = $1
            AND po.warehouse_id = $2

          FOR UPDATE;
        `,
        [
          offerId,
          warehouseId,
        ]
      );

    return result.rows[0] ?? null;
  },


  async setManualPrice(
    {
      offerId,
      price,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          UPDATE product_offers
          SET
            price_mode = 'MANUAL',
            manual_retail_price = $2,
            manual_price_updated_at =
              CURRENT_TIMESTAMP,
            updated_at =
              CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *;
        `,
        [
          offerId,
          price,
        ]
      );

    return result.rows[0] ?? null;
  },


  async resetAutomaticPrice(
    offerId,
    db = pool
  ) {
    const result =
      await db.query(
        `
          UPDATE product_offers
          SET
            price_mode = 'AUTO',
            manual_retail_price = NULL,
            manual_price_updated_at =
              NULL,
            updated_at =
              CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *;
        `,
        [offerId]
      );

    return result.rows[0] ?? null;
  },


  async setVisibility(
    {
      offerId,
      hidden,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          UPDATE product_offers
          SET
            is_hidden = $2,
            hidden_at =
              CASE
                WHEN $2 = TRUE
                THEN CURRENT_TIMESTAMP
                ELSE NULL
              END,
            updated_at =
              CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *;
        `,
        [
          offerId,
          hidden,
        ]
      );

    return result.rows[0] ?? null;
  },


  async addPriceHistory(
    {
      productId,
      offerId,
      oldPrice,
      newPrice,
      changedBy,
      changePercent,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          INSERT INTO price_history (
            product_id,
            product_offer_id,
            old_price,
            new_price,
            changed_by,
            change_percent
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
          )
          RETURNING *;
        `,
        [
          productId,
          offerId,
          oldPrice,
          newPrice,
          changedBy,
          changePercent,
        ]
      );

    return result.rows[0];
  },


  async listPriceHistory(
    {
      warehouseId,
      offerId,
      limit,
    },
    db = pool
  ) {
    const result =
      await db.query(
        `
          SELECT
            ph.id,
            ph.product_id,
            ph.product_offer_id,
            ph.old_price,
            ph.new_price,
            ph.change_percent,
            ph.changed_by,
            ph.created_at

          FROM price_history ph

          JOIN product_offers po
            ON po.id =
              ph.product_offer_id

          WHERE ph.product_offer_id = $1
            AND po.warehouse_id = $2

          ORDER BY
            ph.created_at DESC,
            ph.id DESC

          LIMIT $3;
        `,
        [
          offerId,
          warehouseId,
          limit,
        ]
      );

    return result.rows;
  },
};
