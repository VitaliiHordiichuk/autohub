import {
  pool,
} from "../config/db.js";


export const FunnelAnalyticsRepository = {
  async createEvent(event) {
    const result = await pool.query(
      `
        INSERT INTO funnel_events (
          event_type,
          visitor_session_id,
          user_id,
          product_id,
          product_offer_id,
          cart_id,
          checkout_id,
          order_id,
          vin_request_id,
          source,
          locale
        )
        SELECT
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11
        WHERE NOT (
          $1::varchar = 'PRODUCT_VIEW'
          AND EXISTS (
            SELECT 1
            FROM funnel_events previous
            WHERE previous.event_type = 'PRODUCT_VIEW'
              AND previous.product_id = $4
              AND previous.created_at >=
                CURRENT_TIMESTAMP - INTERVAL '30 minutes'
              AND (
                ($2::varchar IS NOT NULL AND
                  previous.visitor_session_id = $2)
                OR
                ($2::varchar IS NULL AND $3::integer IS NOT NULL AND
                  previous.user_id = $3)
              )
          )
        )
        ON CONFLICT DO NOTHING
        RETURNING id;
      `,
      [
        event.eventType,
        event.visitorSessionId,
        event.userId,
        event.productId,
        event.productOfferId,
        event.cartId,
        event.checkoutId,
        event.orderId,
        event.vinRequestId,
        event.source,
        event.locale,
      ]
    );

    return result.rows[0]
      ? Number(result.rows[0].id)
      : null;
  },
};
