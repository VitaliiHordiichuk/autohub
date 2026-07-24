import { pool } from "../config/db.js";

function mapDelivery(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    orderId: Number(row.order_id),
    deliveryMethod: row.delivery_method,
    recipientFirstName:
      row.recipient_first_name,
    recipientLastName:
      row.recipient_last_name,
    recipientPhone:
      row.recipient_phone,
    recipientEmail:
      row.recipient_email,
    pickupWarehouseId:
      row.pickup_warehouse_id === null
        ? null
        : Number(row.pickup_warehouse_id),
    novaPoshta: {
      cityRef:
        row.nova_poshta_city_ref,
      cityName:
        row.nova_poshta_city_name,
      pointType:
        row.nova_poshta_point_type,
      pointRef:
        row.nova_poshta_point_ref,
      pointNumber:
        row.nova_poshta_point_number,
      pointName:
        row.nova_poshta_point_name,
      pointAddress:
        row.nova_poshta_point_address,
      streetRef:
        row.nova_poshta_street_ref,
      streetName:
        row.nova_poshta_street_name,
      building:
        row.nova_poshta_building,
      apartment:
        row.nova_poshta_apartment,
      courierComment:
        row.courier_comment,
    },
    createdAt: row.created_at,
  };
}

export const OrderDeliveryRepository = {
  async create(
    {
      orderId,
      delivery,
    },
    db = pool
  ) {
    const sql = `
      INSERT INTO order_delivery_details (
        order_id,
        delivery_method,
        recipient_first_name,
        recipient_last_name,
        recipient_phone,
        recipient_email,
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
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19
      )
      RETURNING *;
    `;

    const values = [
      orderId,
      delivery.deliveryMethod,
      delivery.recipientFirstName,
      delivery.recipientLastName,
      delivery.recipientPhone,
      delivery.recipientEmail,
      delivery.pickupWarehouseId,
      delivery.novaPoshtaCityRef,
      delivery.novaPoshtaCityName,
      delivery.novaPoshtaPointType,
      delivery.novaPoshtaPointRef,
      delivery.novaPoshtaPointNumber,
      delivery.novaPoshtaPointName,
      delivery.novaPoshtaPointAddress,
      delivery.novaPoshtaStreetRef,
      delivery.novaPoshtaStreetName,
      delivery.novaPoshtaBuilding,
      delivery.novaPoshtaApartment,
      delivery.courierComment,
    ];

    const result = await db.query(
      sql,
      values
    );

    return mapDelivery(result.rows[0]);
  },

  async findByOrderId(
    orderId,
    db = pool
  ) {
    const sql = `
      SELECT *
      FROM order_delivery_details
      WHERE order_id = $1
      LIMIT 1;
    `;

    const result = await db.query(
      sql,
      [orderId]
    );

    return mapDelivery(
      result.rows[0] ?? null
    );
  },

  async findByOrderIds(
    orderIds,
    db = pool
  ) {
    if (!orderIds.length) {
      return [];
    }

    const sql = `
      SELECT *
      FROM order_delivery_details
      WHERE order_id = ANY($1::integer[])
      ORDER BY order_id;
    `;

    const result = await db.query(
      sql,
      [orderIds]
    );

    return result.rows.map(mapDelivery);
  },
};
