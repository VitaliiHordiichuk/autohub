import { pool } from "../config/db.js";

export const UserDeliveryProfileRepository = {
  async findByUserId(userId, db = pool) {
    const sql = `
      SELECT
        p.*,
        u.first_name AS account_first_name,
        u.last_name AS account_last_name,
        u.phone AS account_phone,
        u.email AS account_email
      FROM users u
      LEFT JOIN user_delivery_profiles p
        ON p.user_id = u.id
      WHERE u.id = $1
      LIMIT 1;
    `;

    const result = await db.query(sql, [userId]);

    return result.rows[0] ?? null;
  },

  async upsert(data, db = pool) {
    const sql = `
      INSERT INTO user_delivery_profiles (
        user_id,
        recipient_first_name,
        recipient_last_name,
        recipient_phone,
        recipient_email,
        delivery_method,
        pickup_warehouse_id,
        nova_poshta_city_ref,
        nova_poshta_city_name,
        nova_poshta_point_type,
        nova_poshta_point_ref,
        nova_poshta_point_number,
        nova_poshta_point_name,
        nova_poshta_point_address,
        nova_poshta_street_ref,
        nova_poshta_street_name,
        nova_poshta_building,
        nova_poshta_apartment,
        courier_comment
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        recipient_first_name = EXCLUDED.recipient_first_name,
        recipient_last_name = EXCLUDED.recipient_last_name,
        recipient_phone = EXCLUDED.recipient_phone,
        recipient_email = EXCLUDED.recipient_email,
        delivery_method = EXCLUDED.delivery_method,
        pickup_warehouse_id = EXCLUDED.pickup_warehouse_id,
        nova_poshta_city_ref = EXCLUDED.nova_poshta_city_ref,
        nova_poshta_city_name = EXCLUDED.nova_poshta_city_name,
        nova_poshta_point_type = EXCLUDED.nova_poshta_point_type,
        nova_poshta_point_ref = EXCLUDED.nova_poshta_point_ref,
        nova_poshta_point_number = EXCLUDED.nova_poshta_point_number,
        nova_poshta_point_name = EXCLUDED.nova_poshta_point_name,
        nova_poshta_point_address = EXCLUDED.nova_poshta_point_address,
        nova_poshta_street_ref = EXCLUDED.nova_poshta_street_ref,
        nova_poshta_street_name = EXCLUDED.nova_poshta_street_name,
        nova_poshta_building = EXCLUDED.nova_poshta_building,
        nova_poshta_apartment = EXCLUDED.nova_poshta_apartment,
        courier_comment = EXCLUDED.courier_comment,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [
      data.userId,
      data.recipientFirstName,
      data.recipientLastName,
      data.recipientPhone,
      data.recipientEmail,
      data.deliveryMethod,
      data.pickupWarehouseId,
      data.novaPoshtaCityRef,
      data.novaPoshtaCityName,
      data.novaPoshtaPointType,
      data.novaPoshtaPointRef,
      data.novaPoshtaPointNumber,
      data.novaPoshtaPointName,
      data.novaPoshtaPointAddress,
      data.novaPoshtaStreetRef,
      data.novaPoshtaStreetName,
      data.novaPoshtaBuilding,
      data.novaPoshtaApartment,
      data.courierComment,
    ];

    const result = await db.query(sql, values);

    return result.rows[0];
  },
};
