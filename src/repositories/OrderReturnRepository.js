import { pool } from "../config/db.js";

export const OrderReturnRepository = {
  async listForManager({status=null,limit=100,offset=0}={}, db=pool) {
    const values=[];
    const where=[];
    if(status){values.push(status);where.push(`r.status=$${values.length}`);}
    values.push(limit,offset);
    const result=await db.query(`SELECT r.id,r.order_id,r.status,r.reason,r.created_at,r.confirmed_at,
      d.recipient_first_name,d.recipient_last_name,d.recipient_phone,
      COALESCE(SUM(ri.quantity*ri.unit_price),0) AS total_amount,
      COALESCE(SUM(ri.quantity),0) AS total_quantity,
      COUNT(ri.id)::integer AS items_count,
      COALESCE(json_agg(json_build_object('id',ri.id,'orderItemId',ri.order_item_id,'quantity',ri.quantity,
        'unitPrice',ri.unit_price,'article',p.article,'name',p.name) ORDER BY ri.id) FILTER (WHERE ri.id IS NOT NULL),'[]') AS items
      FROM order_returns r
      LEFT JOIN order_return_items ri ON ri.return_id=r.id
      LEFT JOIN order_items oi ON oi.id=ri.order_item_id
      LEFT JOIN products p ON p.id=oi.product_id
      LEFT JOIN order_delivery_details d ON d.order_id=r.order_id
      ${where.length?`WHERE ${where.join(" AND ")}`:""}
      GROUP BY r.id,d.id ORDER BY (r.status='PENDING') DESC,r.created_at DESC
      LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    return result.rows.map((row)=>({...row,id:Number(row.id),order_id:Number(row.order_id),
      total_amount:Number(row.total_amount),total_quantity:Number(row.total_quantity),items_count:Number(row.items_count),
      items:row.items.map((item)=>({...item,id:Number(item.id),orderItemId:Number(item.orderItemId),quantity:Number(item.quantity),unitPrice:Number(item.unitPrice)}))}));
  },

  async managerCounts(db=pool) {
    const result=await db.query(`SELECT COUNT(*)::integer AS all_count,
      COUNT(*) FILTER (WHERE status='PENDING')::integer AS pending_count,
      COUNT(*) FILTER (WHERE status='COMPLETED')::integer AS completed_count
      FROM order_returns`);
    return result.rows[0];
  },

  async listByOrder(orderId, db=pool) {
    const result = await db.query(`SELECT r.id,r.order_id,r.status,r.reason,r.created_at,r.confirmed_at,
      COALESCE(json_agg(json_build_object('id',ri.id,'orderItemId',ri.order_item_id,'quantity',ri.quantity,
        'unitPrice',ri.unit_price,'article',p.article,'name',p.name) ORDER BY ri.id) FILTER (WHERE ri.id IS NOT NULL),'[]') AS items
      FROM order_returns r LEFT JOIN order_return_items ri ON ri.return_id=r.id
      LEFT JOIN order_items oi ON oi.id=ri.order_item_id LEFT JOIN products p ON p.id=oi.product_id
      WHERE r.order_id=$1 GROUP BY r.id ORDER BY r.created_at DESC`, [orderId]);
    return result.rows.map((row)=>({...row,id:Number(row.id),items:row.items.map((item)=>({...item,id:Number(item.id),orderItemId:Number(item.orderItemId),quantity:Number(item.quantity),unitPrice:Number(item.unitPrice)}))}));
  },

  async returnedQuantity(orderItemId, db=pool) {
    const result = await db.query(`SELECT COALESCE(SUM(ri.quantity),0) AS quantity FROM order_return_items ri
      JOIN order_returns r ON r.id=ri.return_id WHERE ri.order_item_id=$1 AND r.status IN ('PENDING','COMPLETED')`, [orderItemId]);
    return Number(result.rows[0].quantity);
  },

  async create({orderId,reason,createdBy,items}, db=pool) {
    const result = await db.query(`INSERT INTO order_returns(order_id,reason,created_by) VALUES($1,$2,$3) RETURNING *`, [orderId,reason,createdBy]);
    const created = result.rows[0];
    for (const item of items) {
      await db.query(`INSERT INTO order_return_items(return_id,order_item_id,quantity,unit_price) VALUES($1,$2,$3,$4)`, [created.id,item.orderItemId,item.quantity,item.unitPrice]);
    }
    return created;
  },

  async findForUpdate(returnId, db=pool) {
    const result = await db.query(`SELECT * FROM order_returns WHERE id=$1 FOR UPDATE`, [returnId]);
    return result.rows[0] || null;
  },

  async items(returnId, db=pool) {
    const result = await db.query(`SELECT ri.*,oi.product_id,oi.product_offer_id,p.article,p.name
      FROM order_return_items ri JOIN order_items oi ON oi.id=ri.order_item_id JOIN products p ON p.id=oi.product_id
      WHERE ri.return_id=$1 ORDER BY ri.id`, [returnId]);
    return result.rows;
  },

  async complete(returnId,confirmedBy,db=pool) {
    const result = await db.query(`UPDATE order_returns SET status='COMPLETED',confirmed_by=$2,confirmed_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`, [returnId,confirmedBy]);
    return result.rows[0];
  },
};
