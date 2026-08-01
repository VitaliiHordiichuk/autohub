import { pool } from "../config/db.js";

const select = `SELECT vr.*, u.email, u.first_name, u.last_name, u.phone AS user_phone,
  CONCAT_WS(' ',u.first_name,u.last_name) AS customer_name
  FROM vin_requests vr JOIN users u ON u.id=vr.user_id`;

export const VinRequestRepository = {
  async create({userId,vin,requestText,contactPhone},db=pool){
    const result=await db.query(`INSERT INTO vin_requests(user_id,vin,request_text,contact_phone)
      VALUES($1,$2,$3,$4) RETURNING *`,[userId,vin,requestText,contactPhone]);
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
  async update({id,status,response,answeredBy},db=pool){
    const result=await db.query(`UPDATE vin_requests SET status=$2,manager_response=$3,
      answered_by=CASE WHEN $3::text IS NOT NULL AND BTRIM($3)<>'' THEN $4 ELSE answered_by END,
      answered_at=CASE WHEN $3::text IS NOT NULL AND BTRIM($3)<>'' THEN CURRENT_TIMESTAMP ELSE answered_at END,
      updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[id,status,response,answeredBy]);
    return result.rows[0]??null;
  },
  async summary(db=pool){
    const result=await db.query(`SELECT COUNT(*) FILTER(WHERE status='NEW')::integer AS new_count,
      COUNT(*) FILTER(WHERE status IN('NEW','IN_PROGRESS'))::integer AS active_count FROM vin_requests`);
    return result.rows[0];
  },
};
