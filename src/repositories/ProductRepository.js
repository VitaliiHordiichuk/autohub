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
          pm.name AS manufacturer,
          pt.name AS product_type

      FROM products p

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
      po.quantity,
      po.purchase_price,
      po.retail_price,
      po.delivery_days,
      po.source_type,
      po.is_available,

      w.name AS warehouse_name,
      w.city AS warehouse_city,

      s.name AS supplier_name

    FROM product_offers po

    LEFT JOIN warehouses w
      ON w.id = po.warehouse_id

    LEFT JOIN suppliers s
      ON s.id = po.supplier_id

    WHERE po.product_id = $1
      AND po.is_available = TRUE

    ORDER BY
      CASE
        WHEN po.source_type = 'OWN_STOCK' THEN 1
        ELSE 2
      END,
      po.retail_price ASC;
  `;

  const result = await pool.query(sql, [productId]);

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

      pm.name AS manufacturer,
      pt.name AS product_type

    FROM products p

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
      pm.name AS manufacturer,
      pt.name AS product_type,
      pr.relation_type

    FROM product_relations pr

    JOIN products p
      ON p.id = pr.related_product_id

    LEFT JOIN part_manufacturers pm
      ON pm.id = p.manufacturer_id

    LEFT JOIN product_types pt
      ON pt.id = p.product_type_id

    WHERE pr.product_id = $1
      AND pr.relation_type = $2
      AND p.is_active = TRUE

    ORDER BY pm.name, p.article;
  `;

  const result = await pool.query(sql, [productId, relationType]);

  return result.rows;
},
async findOfferById(id) {

    const sql = `
        SELECT *
        FROM product_offers
        WHERE id=$1
    `;

    const result =
        await pool.query(sql, [id]);

    if (!result.rows.length) {
        return null;
    }

    const offer = result.rows[0];

    return {
        id: offer.id,
        productId: offer.product_id,
        quantity: Number(offer.quantity),
        retailPrice: Number(offer.retail_price),
        purchasePrice: Number(offer.purchase_price),
        sourceType: offer.source_type,
        isAvailable: Number(offer.quantity) > 0
    };
},
async findOfferByIdForUpdate(id, db = pool) {
  const sql = `
    SELECT
      id,
      product_id,
      warehouse_id,
      supplier_id,
      quantity,
      purchase_price,
      retail_price,
      source_type,
      is_available
    FROM product_offers
    WHERE id = $1
    FOR UPDATE;
  `;

  const result = await db.query(sql, [id]);

  if (!result.rows.length) {
    return null;
  }

  const offer = result.rows[0];

  return {
    id: offer.id,
    productId: offer.product_id,
    warehouseId: offer.warehouse_id,
    supplierId: offer.supplier_id,
    quantity: Number(offer.quantity),
    retailPrice:
      offer.retail_price === null
        ? null
        : Number(offer.retail_price),
    purchasePrice:
      offer.purchase_price === null
        ? null
        : Number(offer.purchase_price),
    sourceType: offer.source_type,
    isAvailable:
      offer.is_available === true &&
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
};