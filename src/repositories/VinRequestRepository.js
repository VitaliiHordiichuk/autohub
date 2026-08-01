import { pool } from "../config/db.js";

const select = `SELECT vr.*, vb.name AS vehicle_brand_name, u.email, u.first_name, u.last_name, u.phone AS user_phone,
  CONCAT_WS(' ',u.first_name,u.last_name) AS customer_name,
  COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT(
    'id',m.id,'message',m.message,'created_at',m.created_at,
    'sender_user_id',m.sender_user_id,'sender_role',COALESCE(m.sender_role,sr.name),
    'sender_name',COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',su.first_name,su.last_name)),''),su.email,'Сотрудник')
  ) ORDER BY m.created_at,m.id)
  FROM vin_request_messages m
  LEFT JOIN users su ON su.id=m.sender_user_id
  LEFT JOIN roles sr ON sr.id=su.role_id
  WHERE m.vin_request_id=vr.id),'[]'::json) AS messages
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
