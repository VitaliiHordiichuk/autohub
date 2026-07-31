import { NotificationRepository } from "../repositories/NotificationRepository.js";

function mapNotification(row) {
  return {
    id: Number(row.id),
    type: row.type,
    orderId: row.order_id === null ? null : Number(row.order_id),
    payload: row.payload || {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export async function getNotifications(req, res) {
  try {
    const [rows, unreadCount] = await Promise.all([
      NotificationRepository.listForUser(req.auth.userId),
      NotificationRepository.unreadCount(req.auth.userId),
    ]);
    return res.json({ success: true, unreadCount, notifications: rows.map(mapNotification) });
  } catch (error) {
    console.error("Ошибка получения уведомлений:", error);
    return res.status(500).json({ success: false, error: "Не удалось получить уведомления" });
  }
}

export async function getNotificationSummary(req, res) {
  try {
    const unreadCount = await NotificationRepository.unreadCount(req.auth.userId);
    return res.json({ success: true, unreadCount });
  } catch (error) {
    console.error("Ошибка счётчика уведомлений:", error);
    return res.status(500).json({ success: false, error: "Не удалось получить счётчик уведомлений" });
  }
}

export async function markAllNotificationsRead(req, res) {
  try {
    const updated = await NotificationRepository.markAllRead(req.auth.userId);
    return res.json({ success: true, updated });
  } catch (error) {
    console.error("Ошибка прочтения уведомлений:", error);
    return res.status(500).json({ success: false, error: "Не удалось отметить уведомления" });
  }
}
