import { pool } from "../config/db.js";

export const StockMovementRepository = {
  async createSaleMovement(
    {
      productId,
      productOfferId,
      orderId,
      orderItemId,
      quantity,
      oldQuantity,
      newQuantity,
      changedBy = null,
      comment = null,
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO stock_movements (
        product_id,
        product_offer_id,
        order_id,
        order_item_id,
        quantity,
        type,
        status,
        old_quantity,
        new_quantity,
        created_by,
        comment
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'SALE',
        'COMPLETED',
        $6,
        $7,
        $8,
        $9
      )
      RETURNING *;
    `;

    const result = await db.query(sql, [
      productId,
      productOfferId,
      orderId,
      orderItemId,
      quantity,
      oldQuantity,
      newQuantity,
      changedBy,
      comment,
    ]);

    return result.rows[0];
  },
  async createReturnMovement({productId,productOfferId,orderId,orderItemId,quantity,oldQuantity,newQuantity,changedBy,comment}, db=pool) {
    const result = await db.query(`INSERT INTO stock_movements(product_id,product_offer_id,order_id,order_item_id,
      quantity,type,status,old_quantity,new_quantity,created_by,comment)
      VALUES($1,$2,$3,$4,$5,'RETURN','COMPLETED',$6,$7,$8,$9) RETURNING *`,
      [productId,productOfferId,orderId,orderItemId,quantity,oldQuantity,newQuantity,changedBy,comment]);
    return result.rows[0];
  },
};
