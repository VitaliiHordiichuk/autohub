import { pool } from "../config/db.js";
import { EmailService } from "./EmailService.js";
import { buildOrderEmail } from "./OrderEmailTemplate.js";

export const OrderEmailNotificationService = {
  async send({ orderId, type, trackingNumber }, db = pool, transport = EmailService.sendOrderNotification) {
    if (process.env.ORDER_EMAIL_NOTIFICATIONS_ENABLED !== "true" ||
        process.env.EMAIL_DELIVERY_DISABLED === "true") return { sent: false, reason: "DISABLED" };
    if (!EmailService.isConfigured()) return { sent: false, reason: "NOT_CONFIGURED" };
    try {
      const id = Number(orderId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid order ID");
      const result = await db.query(`SELECT o.id, o.status, o.total_amount, o.tracking_number,
        d.recipient_email, d.delivery_method
        FROM orders o JOIN order_delivery_details d ON d.order_id=o.id
        WHERE o.id=$1`, [id]);
      const order = result.rows[0];
      const to = String(order?.recipient_email || "").trim();
      // Use the address entered for this order, including guest orders.
      // Do not fall back to an unrelated account/profile email.
      if (!to || to.length > 254 || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(to)) {
        return { sent: false, reason: "NO_VALID_ORDER_EMAIL" };
      }
      // The creation event is dispatched only for a newly committed order. A
      // manager may already have confirmed it before this background read.
      if (type === "created" && !["NEW", "CONFIRMED"].includes(order.status)) return { sent: false, reason: "STATUS_CHANGED" };
      if (type === "confirmed" && order.status !== "CONFIRMED") return { sent: false, reason: "STATUS_CHANGED" };
      if (type === "tracking" && (order.tracking_number !== trackingNumber ||
          !["NOVA_POSHTA_POINT", "NOVA_POSHTA_COURIER"].includes(order.delivery_method))) {
        return { sent: false, reason: "TRACKING_CHANGED" };
      }
      const items = ["created", "confirmed"].includes(type) ? (await db.query(`
        SELECT p.article, p.name, oi.quantity, oi.price_at_purchase
        FROM order_items oi JOIN products p ON p.id=oi.product_id
        WHERE oi.order_id=$1 AND oi.status='ACTIVE' ORDER BY oi.id`, [id])).rows : [];
      return await transport({ to, ...buildOrderEmail({ type, order, items, trackingNumber }) });
    } catch (error) {
      // No addresses, bodies, credentials or provider responses in logs.
      console.error("MAKA order email failed", { orderId: Number(orderId), type, code: error.code || "EMAIL_FAILED" });
      return { sent: false, reason: "SEND_FAILED" };
    }
  },
};
