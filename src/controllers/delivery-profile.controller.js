import {
  DeliveryProfileService,
} from "../services/DeliveryProfileService.js";

function sendError(res, error) {
  const statusCode =
    Number(error.statusCode) || 500;

  if (statusCode >= 500) {
    console.error("Delivery profile error:", error);
  }

  return res.status(statusCode).json({
    success: false,
    error:
      statusCode >= 500
        ? "Внутренняя ошибка сервера"
        : error.message,
  });
}

export async function getDeliveryProfile(req, res) {
  try {
    const profile =
      await DeliveryProfileService.getByUserId(
        req.auth.userId
      );

    return res.json({
      success: true,
      profile,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function saveDeliveryProfile(req, res) {
  try {
    const profile =
      await DeliveryProfileService.save(
        req.auth.userId,
        req.body
      );

    return res.json({
      success: true,
      profile,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
