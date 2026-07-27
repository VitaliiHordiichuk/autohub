import { pool } from "../config/db.js";

export const ProductRepository = {
  async findByNormalizedArticle(articleNormalized) {
    const sql = `
      SELECT
          p.id,
          p.article,
          p.article_normalized,
          p.name,

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

      WHERE p.article_normalized = $1

      LIMIT 1;
    `;

    const result = await pool.query(sql, [articleNormalized]);

    return result.rows[0] ?? null;
  },
  
  async findOffersByProductId(productId) {
    const sql = `
      SELECT
        po.id,
        po.product_id,
        po.warehouse_id,
        po.supplier_id,

        COALESCE(
          po.supplier_id,
          w.supplier_id
        ) AS effective_supplier_id,

        po.quantity,
        po.purchase_price,

        po.retail_price
          AS automatic_retail_price,

        po.manual_retail_price,
        po.price_mode,

        CASE
          WHEN
            po.price_mode = 'MANUAL'
            AND po.manual_retail_price
              IS NOT NULL
          THEN po.manual_retail_price

          ELSE po.retail_price
        END AS retail_price,

        po.delivery_days,
        po.source_type,
        po.is_available,
        po.is_hidden,

        w.name AS warehouse_name,
        w.city AS warehouse_city,
        w.priority AS warehouse_priority,
        w.is_active AS warehouse_active,

        s.name AS supplier_name,
        s.type AS supplier_type,
        s.warehouse_priority_enabled

      FROM product_offers po

      LEFT JOIN warehouses w
        ON w.id = po.warehouse_id

      LEFT JOIN suppliers s
        ON s.id = COALESCE(
          po.supplier_id,
          w.supplier_id
        )

      WHERE po.product_id = $1
        AND po.is_available = TRUE
        AND po.is_hidden = FALSE
        AND po.quantity > 0

        AND (
          w.id IS NULL
          OR w.is_active = TRUE
        )

        AND (
          s.id IS NULL
          OR s.is_active = TRUE
        )

      ORDER BY
        CASE
          WHEN s.type = 'OWN'
            OR (
              s.id IS NULL
              AND po.source_type =
                'OWN_STOCK'
            )
          THEN 1
          ELSE 2
        END,

        s.name NULLS FIRST,
        w.priority ASC NULLS LAST,

        CASE
          WHEN
            po.price_mode = 'MANUAL'
            AND po.manual_retail_price
              IS NOT NULL
          THEN po.manual_retail_price

          ELSE po.retail_price
        END ASC NULLS LAST,

        po.id;
    `;

    const result =
      await pool.query(
        sql,
        [productId]
      );

    return result.rows;
  },

async findMercedesFamilyByBase(articleBase) {
  const sql = `
    SELECT
      p.id,
      p.article,
      p.article_normalized,
      p.article_base,
      p.article_suffix,
      p.article_suffix_length,
      p.variant_type,
      p.name,

      COALESCE(
        b.name,
        pm.name
      ) AS manufacturer,
      pt.name AS product_type

    FROM products p

    LEFT JOIN brands b
      ON b.id = p.brand_id

    LEFT JOIN part_manufacturers pm
      ON pm.id = p.manufacturer_id

    LEFT JOIN product_types pt
      ON pt.id = p.product_type_id

    WHERE p.article_base = $1
      AND p.is_active = TRUE

    ORDER BY
      CASE p.variant_type
        WHEN 'BASE' THEN 1
        WHEN 'SAME' THEN 2
        WHEN 'VARIANT' THEN 3
        ELSE 4
      END,
      p.article;
  `;

  const result = await pool.query(sql, [articleBase]);

  return result.rows;
},
async findRelatedProducts(productId, relationType) {
  const sql = `
    SELECT
      p.id,
      p.article,
      p.article_normalized,
      p.name,
      COALESCE(
        b.name,
        pm.name
      ) AS manufacturer,
      pt.name AS product_type,
      pr.relation_type

    FROM product_relations pr

    JOIN products p
      ON p.id = pr.related_product_id

    LEFT JOIN brands b
      ON b.id = p.brand_id

    LEFT JOIN part_manufacturers pm
      ON pm.id = p.manufacturer_id

    LEFT JOIN product_types pt
      ON pt.id = p.product_type_id

    WHERE pr.product_id = $1
      AND pr.relation_type = $2
      AND p.is_active = TRUE

    ORDER BY
      COALESCE(
        b.name,
        pm.name
      ),
      p.article;
  `;

  const result = await pool.query(sql, [productId, relationType]);

  return result.rows;
},
async findOfferById(
  id,
  db = pool
) {
  const sql = `
    SELECT
      id,
      product_id,
      warehouse_id,
      supplier_id,
      quantity,
      purchase_price,

      CASE
        WHEN price_mode = 'MANUAL'
          AND manual_retail_price IS NOT NULL
        THEN manual_retail_price
        ELSE retail_price
      END AS retail_price,

      source_type,
      is_available,
      is_hidden

    FROM product_offers

    WHERE id = $1

    LIMIT 1;
  `;

  const result =
    await db.query(
      sql,
      [id]
    );

  if (!result.rows.length) {
    return null;
  }

  const offer = result.rows[0];

  return {
    id:
      Number(offer.id),

    productId:
      Number(offer.product_id),

    warehouseId:
      offer.warehouse_id === null
        ? null
        : Number(offer.warehouse_id),

    supplierId:
      offer.supplier_id === null
        ? null
        : Number(offer.supplier_id),

    quantity:
      Number(offer.quantity),

    retailPrice:
      offer.retail_price === null
        ? null
        : Number(offer.retail_price),

    purchasePrice:
      offer.purchase_price === null
        ? null
        : Number(offer.purchase_price),

    sourceType:
      offer.source_type,

    isAvailable:
      offer.is_available === true &&
      offer.is_hidden !== true &&
      Number(offer.quantity) > 0,
  };
},

async findOfferByIdForUpdate(
  id,
  db = pool
) {
  const sql = `
    SELECT
      id,
      product_id,
      warehouse_id,
      supplier_id,
      quantity,
      purchase_price,

      CASE
        WHEN price_mode = 'MANUAL'
          AND manual_retail_price IS NOT NULL
        THEN manual_retail_price
        ELSE retail_price
      END AS retail_price,

      source_type,
      is_available,
      is_hidden

    FROM product_offers

    WHERE id = $1

    FOR UPDATE;
  `;

  const result =
    await db.query(
      sql,
      [id]
    );

  if (!result.rows.length) {
    return null;
  }

  const offer = result.rows[0];

  return {
    id:
      Number(offer.id),

    productId:
      Number(offer.product_id),

    warehouseId:
      offer.warehouse_id === null
        ? null
        : Number(offer.warehouse_id),

    supplierId:
      offer.supplier_id === null
        ? null
        : Number(offer.supplier_id),

    quantity:
      Number(offer.quantity),

    retailPrice:
      offer.retail_price === null
        ? null
        : Number(offer.retail_price),

    purchasePrice:
      offer.purchase_price === null
        ? null
        : Number(offer.purchase_price),

    sourceType:
      offer.source_type,

    isAvailable:
      offer.is_available === true &&
      offer.is_hidden !== true &&
      Number(offer.quantity) > 0,
  };
},

async decreaseQuantityForSale(
  productOfferId,
  quantity,
  db = pool
) {
  const sql = `
    WITH locked_offer AS (
      SELECT
        id,
        quantity AS old_quantity
      FROM product_offers
      WHERE id = $1
      FOR UPDATE
    ),

    updated_offer AS (
      UPDATE product_offers po
      SET
  quantity = po.quantity - $2,
  is_available = (po.quantity - $2) > 0,
  updated_at = CURRENT_TIMESTAMP
      FROM locked_offer lo
      WHERE po.id = lo.id
        AND lo.old_quantity >= $2
      RETURNING
        po.*,
        lo.old_quantity
    )

    SELECT
      *,
      quantity AS new_quantity
    FROM updated_offer;
  `;

  const result = await db.query(sql, [
    productOfferId,
    quantity,
  ]);

  return result.rows[0] ?? null;
},
async findByBrandAndArticle(
  brandId,
  articleNormalized,
  db = pool
) {

  const sql = `
    SELECT *
    FROM products
    WHERE brand_id = $1
      AND article_normalized = $2
    LIMIT 1;
  `;


  const result = await db.query(
    sql,
    [
      brandId,
      articleNormalized
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

  const sql = `
    INSERT INTO products
    (
      brand_id,
      article,
      article_normalized,
      name
    )

    VALUES
    (
      $1,
      $2,
      $3,
      $4
    )

    RETURNING *;
  `;


  const result = await db.query(
    sql,
    [
      brandId,
      article,
      articleNormalized,
      name
    ]
  );


  return result.rows[0];
},

async createOffer(
  {
    productId,
    warehouseId,
    supplierId = null,
    quantity,
    purchasePrice,
    sourceType = "OWN_STOCK",
  },
  db = pool
) {

  const sql = `
    INSERT INTO product_offers
    (
      product_id,
      warehouse_id,
      supplier_id,
      quantity,
      purchase_price,
      source_type,
      is_available,
      updated_at
    )

    VALUES
    (
      $1,
      $2,
      $3,
      $4::numeric,
      $5::numeric,
      $6,
      ($4::numeric > 0),
      CURRENT_TIMESTAMP
    )

    RETURNING *;
  `;


  const result = await db.query(
    sql,
    [
      productId,
      warehouseId,
      supplierId,
      quantity,
      purchasePrice,
      sourceType
    ]
  );


  return result.rows[0];
},
async updateOfferStock(
  offerId,
  {
    quantity,
    purchasePrice,
  },
  db = pool
) {

  // 1. Получаем старую цену
  const oldResult = await db.query(
    `
    SELECT
      id,
      product_id,
      purchase_price
    FROM product_offers
    WHERE id = $1
    FOR UPDATE;
    `,
    [
      offerId
    ]
  );


  if (!oldResult.rows.length) {
    return null;
  }


  const oldOffer = oldResult.rows[0];

  const oldPrice =
    oldOffer.purchase_price === null
      ? null
      : Number(oldOffer.purchase_price);



  // 2. Обновляем предложение
  const updateResult = await db.query(
    `
    UPDATE product_offers
    SET
      quantity = $2::numeric,
      purchase_price = $3::numeric,
      is_available = ($2::numeric > 0),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
    `,
    [
      offerId,
      quantity,
      purchasePrice
    ]
  );


  const updatedOffer =
    updateResult.rows[0];


  if (!updatedOffer) {
    return null;
  }



  // 3. Записываем изменение цены
  if (
    oldPrice !== null &&
    Number(oldPrice) !== Number(purchasePrice)
  ) {

    const changePercent =
      ((Number(purchasePrice) - oldPrice) / oldPrice) * 100;


    await db.query(
      `
      INSERT INTO price_history
      (
        product_id,
        product_offer_id,
        old_price,
        new_price,
        change_percent
      )

      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5
      );
      `,
      [
        oldOffer.product_id,
        offerId,
        oldPrice,
        purchasePrice,
        changePercent.toFixed(2)
      ]
    );

  }


  return updatedOffer;
},

async findOfferByProductAndWarehouse(
  productId,
  warehouseId,
  db = pool
) {


  const sql = `
    SELECT *
    FROM product_offers
    WHERE product_id = $1
      AND warehouse_id = $2;
  `;


  const result = await db.query(
    sql,
    [
      productId,
      warehouseId
    ]
  );


  return result.rows[0] ?? null;
},

  async disableMissingSupplierOffers(
    {
      warehouseId,
      activeOfferIds = [],
    },
    db = pool
  ) {
    const safeOfferIds =
      Array.from(
        new Set(
          activeOfferIds
            .map(
              (value) =>
                Number(value)
            )
            .filter(
              (value) =>
                Number.isInteger(value) &&
                value > 0
            )
        )
      );


    const result =
      await db.query(
        `
          UPDATE product_offers

          SET
            quantity = 0,
            is_available = FALSE,
            updated_at = CURRENT_TIMESTAMP

          WHERE warehouse_id = $1

            AND (
              COALESCE(quantity, 0) <> 0
              OR
              is_available IS DISTINCT FROM FALSE
            )

            AND NOT (
              id = ANY(
                $2::integer[]
              )
            )

          RETURNING id;
        `,
        [
          warehouseId,
          safeOfferIds,
        ]
      );


    return result.rows;
  },

};