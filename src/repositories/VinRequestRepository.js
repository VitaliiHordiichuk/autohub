import { pool } from "../config/db.js";

const select = `SELECT vr.*, vb.name AS vehicle_brand_name, u.email, u.first_name, u.last_name, u.phone AS user_phone,
  (u.vin_chat_blocked_at IS NOT NULL) AS vin_chat_blocked,
  u.vin_chat_blocked_at, u.vin_chat_block_reason,
  CONCAT_WS(' ',u.first_name,u.last_name) AS customer_name,
  COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT(
    'id',m.id,'message',m.message,'created_at',m.created_at,
    'sender_user_id',m.sender_user_id,'sender_role',COALESCE(m.sender_role,sr.name),
    'sender_name',COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',su.first_name,su.last_name)),''),su.email,'Співробітник')
  ) ORDER BY m.created_at,m.id)
  FROM vin_request_messages m
  LEFT JOIN users su ON su.id=m.sender_user_id
  LEFT JOIN roles sr ON sr.id=su.role_id
  WHERE m.vin_request_id=vr.id),'[]'::json) AS messages
  ,COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT(
    'id',rec.id,'created_at',rec.created_at,'dismissed_at',rec.dismissed_at,
    'product_id',p.id,'product_offer_id',po.id,
    'article',p.article,'name',p.name,
    'image_url',(SELECT pi.url FROM product_images pi WHERE pi.product_id=p.id ORDER BY pi.priority,pi.id LIMIT 1),
    'retail_price',CASE WHEN po.price_mode='MANUAL' AND po.manual_retail_price IS NOT NULL THEN po.manual_retail_price ELSE po.retail_price END,
    'minimum_sale_price',po.minimum_sale_price,'delivery_days',po.delivery_days,
    'quantity',GREATEST(po.quantity-COALESCE(reservations.reserved_quantity,0),0),
    'is_available',(p.is_active=TRUE AND po.is_available=TRUE AND po.is_hidden=FALSE
      AND (w.id IS NULL OR w.is_active=TRUE) AND (s.id IS NULL OR s.is_active=TRUE)
      AND GREATEST(po.quantity-COALESCE(reservations.reserved_quantity,0),0)>0),
    'source_label',COALESCE(w.name,s.name,'makahub')
  ) ORDER BY rec.created_at,rec.id)
  FROM vin_request_recommendations rec
  JOIN products p ON p.id=rec.product_id
  JOIN product_offers po ON po.id=rec.product_offer_id
  LEFT JOIN warehouses w ON w.id=po.warehouse_id
  LEFT JOIN suppliers s ON s.id=COALESCE(po.supplier_id,w.supplier_id)
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(sr.quantity),0) AS reserved_quantity FROM stock_reservations sr
    WHERE sr.product_offer_id=po.id AND (sr.status='ORDER_PENDING' OR (sr.status='ACTIVE' AND (sr.order_id IS NOT NULL OR sr.reserved_until IS NULL OR sr.reserved_until>CURRENT_TIMESTAMP)))) reservations ON TRUE
  WHERE rec.vin_request_id=vr.id),'[]'::json) AS recommendations
  FROM vin_requests vr JOIN users u ON u.id=vr.user_id LEFT JOIN vehicle_brands vb ON vb.id=vr.vehicle_brand_id`;

export const VinRequestRepository = {
  async create({userId,vehicleBrandId,vin,requestText,contactPhone},db=pool){
    const result=await db.query(`INSERT INTO vin_requests(user_id,vehicle_brand_id,vin,request_text,contact_phone)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[userId,vehicleBrandId,vin,requestText,contactPhone]);
    return result.rows[0];
  },
  async listForUser(userId,db=pool){
    const result=await db.query(`${select} WHERE vr.user_id=$1 ORDER BY vr.created_at DESC`,[userId]);
    return result.rows;
  },
  async findForUser(id,userId,db=pool){
    const result=await db.query(`${select} WHERE vr.id=$1 AND vr.user_id=$2 LIMIT 1`,[id,userId]);
    return result.rows[0]??null;
  },
  async listForStaff({status=null,limit=100},db=pool){
    const result=await db.query(`${select} WHERE ($1::text IS NULL OR vr.status=$1)
      ORDER BY CASE vr.status WHEN 'NEW' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'ANSWERED' THEN 2 ELSE 3 END,vr.created_at DESC LIMIT $2`,[status,limit]);
    return result.rows;
  },
  async findById(id,db=pool){
    const result=await db.query(`${select} WHERE vr.id=$1 LIMIT 1`,[id]);
    return result.rows[0]??null;
  },
  async update({id,status,response,answeredBy,messageAdded=false},db=pool){
    const result=await db.query(`UPDATE vin_requests SET status=$2,manager_response=$3,
      answered_by=CASE WHEN $5 THEN $4 ELSE answered_by END,
      answered_at=CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE answered_at END,
      updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[id,status,response,answeredBy,messageAdded]);
    return result.rows[0]??null;
  },
  async addMessage({requestId,senderUserId,message},db=pool){
    const result=await db.query(`INSERT INTO vin_request_messages(vin_request_id,sender_user_id,sender_role,message)
      SELECT $1,$2,r.name,$3 FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$2 RETURNING *`,[requestId,senderUserId,message]);
    return result.rows[0]??null;
  },
  async clientMessageStats({requestId,userId,message},db=pool){
    const result=await db.query(`SELECT
      MAX(created_at) AS last_created_at,
      COUNT(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '1 hour')::integer AS hour_count,
      COUNT(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::integer AS day_count,
      COUNT(*) FILTER(WHERE vin_request_id=$1 AND created_at>CURRENT_TIMESTAMP-INTERVAL '5 minutes' AND LOWER(BTRIM(message))=LOWER(BTRIM($3)))::integer AS duplicate_count
      FROM vin_request_messages
      WHERE sender_user_id=$2`,[requestId,userId,message]);
    return result.rows[0];
  },
  async createStats({userId,vin,requestText},db=pool){
    const result=await db.query(`SELECT
      COUNT(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '1 hour')::integer AS hour_count,
      COUNT(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::integer AS day_count,
      COUNT(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '15 minutes'
        AND vin=$2 AND LOWER(BTRIM(request_text))=LOWER(BTRIM($3)))::integer AS duplicate_count
      FROM vin_requests WHERE user_id=$1`,[userId,vin,requestText]);
    return result.rows[0];
  },
  async phoneVerificationStatus(userId,db=pool){
    const result=await db.query(`SELECT u.phone, r.name AS role_name,
      (u.vin_chat_blocked_at IS NOT NULL) AS vin_chat_blocked,
      (u.phone_verified_at IS NOT NULL AND REGEXP_REPLACE(COALESCE(u.phone_verified_value,''),'[^0-9]','','g')=REGEXP_REPLACE(COALESCE(u.phone,''),'[^0-9]','','g')) AS verified,
      EXISTS(SELECT 1 FROM user_telegram_connections c WHERE c.user_id=u.id) AS telegram_connected,
      (SELECT COUNT(*)::integer FROM vin_requests recent
        WHERE recent.user_id=u.id AND recent.created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours') AS recent_request_count
      FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.is_active=TRUE`,[userId]);
    return result.rows[0]??null;
  },
  async setClientBlock({userId,blocked,changedBy,reason=null},db=pool){
    const result=await db.query(`UPDATE users u SET
      vin_chat_blocked_at=CASE WHEN $2::boolean THEN CURRENT_TIMESTAMP ELSE NULL END,
      vin_chat_blocked_by=CASE WHEN $2::boolean THEN $3::integer ELSE NULL::integer END,
      vin_chat_block_reason=CASE WHEN $2::boolean THEN NULLIF(BTRIM($4::text),'') ELSE NULL::text END
      FROM roles r
      WHERE u.id=$1 AND r.id=u.role_id AND r.name='CLIENT'
      RETURNING u.id,u.email,u.first_name,u.last_name,u.phone,
        (u.vin_chat_blocked_at IS NOT NULL) AS vin_chat_blocked,
        u.vin_chat_blocked_at,u.vin_chat_block_reason`,[userId,blocked,changedBy,reason]);
    return result.rows[0]??null;
  },
  async closeOpenForUser(userId,db=pool){
    const result=await db.query(`UPDATE vin_requests SET status='CLOSED',updated_at=CURRENT_TIMESTAMP
      WHERE user_id=$1 AND status<>'CLOSED' RETURNING id`,[userId]);
    return result.rows;
  },
  async touchAfterClientMessage(requestId,db=pool){
    const result=await db.query(`UPDATE vin_requests SET status='IN_PROGRESS',updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status<>'CLOSED' RETURNING *`,[requestId]);
    return result.rows[0]??null;
  },
  async addRecommendation({requestId,productId,productOfferId,addedBy},db=pool){
    const result=await db.query(`INSERT INTO vin_request_recommendations(vin_request_id,product_id,product_offer_id,added_by)
      SELECT $1,p.id,po.id,$4
      FROM products p
      JOIN product_offers po ON po.product_id=p.id
      LEFT JOIN warehouses w ON w.id=po.warehouse_id
      LEFT JOIN suppliers s ON s.id=COALESCE(po.supplier_id,w.supplier_id)
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(sr.quantity),0) AS reserved_quantity
        FROM stock_reservations sr
        WHERE sr.product_offer_id=po.id
          AND (sr.status='ORDER_PENDING' OR (sr.status='ACTIVE'
            AND (sr.order_id IS NOT NULL OR sr.reserved_until IS NULL OR sr.reserved_until>CURRENT_TIMESTAMP)))
      ) reservations ON TRUE
      WHERE p.id=$2 AND po.id=$3 AND p.is_active=TRUE
        AND po.is_available=TRUE AND po.is_hidden=FALSE
        AND (w.id IS NULL OR w.is_active=TRUE)
        AND (s.id IS NULL OR s.is_active=TRUE)
        AND GREATEST(po.quantity-COALESCE(reservations.reserved_quantity,0),0)>0
      ON CONFLICT(vin_request_id,product_offer_id) DO NOTHING RETURNING *`,[requestId,productId,productOfferId,addedBy]);
    return result.rows[0]??null;
  },
  async removeRecommendation({requestId,recommendationId},db=pool){
    const result=await db.query(`DELETE FROM vin_request_recommendations WHERE id=$1 AND vin_request_id=$2 RETURNING *`,[recommendationId,requestId]);
    return result.rows[0]??null;
  },
  async dismissRecommendationForUser({requestId,recommendationId,userId},db=pool){
    const result=await db.query(`UPDATE vin_request_recommendations rec SET
      dismissed_at=COALESCE(rec.dismissed_at,CURRENT_TIMESTAMP),
      dismissed_by_user_id=COALESCE(rec.dismissed_by_user_id,$3)
      FROM vin_requests vr
      WHERE rec.id=$1 AND rec.vin_request_id=$2
        AND vr.id=rec.vin_request_id AND vr.user_id=$3
      RETURNING rec.*`,[recommendationId,requestId,userId]);
    return result.rows[0]??null;
  },
  async settings(db=pool){
    const result=await db.query(`SELECT mode,updated_by,updated_at FROM vin_request_settings WHERE id=1`);
    return result.rows[0]??{mode:'CHAT',updated_by:null,updated_at:null};
  },
  async updateSettings({mode,updatedBy},db=pool){
    const result=await db.query(`UPDATE vin_request_settings SET mode=$1,updated_by=$2,
      updated_at=CURRENT_TIMESTAMP WHERE id=1 RETURNING mode,updated_by,updated_at`,[mode,updatedBy]);
    return result.rows[0];
  },
  async summary(db=pool){
    const result=await db.query(`SELECT COUNT(*) FILTER(WHERE status='NEW')::integer AS new_count,
      COUNT(*) FILTER(WHERE status IN('NEW','IN_PROGRESS'))::integer AS active_count FROM vin_requests`);
    return result.rows[0];
  },
  async supportedBrands(db=pool){const result=await db.query(`SELECT id,name,is_vin_supported FROM vehicle_brands WHERE is_vin_supported=TRUE ORDER BY name`);return result.rows;},
  async allBrands(db=pool){const result=await db.query(`SELECT id,name,is_vin_supported FROM vehicle_brands ORDER BY name`);return result.rows;},
  async supportedBrand(id,db=pool){const result=await db.query(`SELECT id,name FROM vehicle_brands WHERE id=$1 AND is_vin_supported=TRUE`,[id]);return result.rows[0]??null;},
  async addBrand(name,db=pool){const result=await db.query(`INSERT INTO vehicle_brands(name,is_vin_supported) VALUES($1,TRUE) ON CONFLICT ((LOWER(name))) DO UPDATE SET is_vin_supported=TRUE RETURNING *`,[name]);return result.rows[0];},
  async toggleBrand(id,enabled,db=pool){const result=await db.query(`UPDATE vehicle_brands SET is_vin_supported=$2 WHERE id=$1 RETURNING *`,[id,enabled]);return result.rows[0]??null;},
};
