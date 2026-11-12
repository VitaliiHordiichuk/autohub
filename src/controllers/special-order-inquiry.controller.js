import {
  createSpecialOrderInquiry,
} from "../services/SpecialOrderInquiryService.js";
import {
  specialOrderInquiriesEnabled,
} from "../services/SpecialOrderInquiryFeature.js";
import {
  PublicAvailabilityContextService,
} from "../services/PublicAvailabilityContextService.js";

export function makeSpecialOrderInquiryHandler({
  create = createSpecialOrderInquiry,
  enabled = specialOrderInquiriesEnabled,
  availability = req => PublicAvailabilityContextService.fromRequest(req),
} = {}) {
  return async function handleSpecialOrderInquiry(req, res) {
    res.set("Cache-Control", "no-store");

    // An accidentally deployed route stays inactive.
    if (!enabled()) {
      return res.status(503).json({
        success: false,
        code: "SPECIAL_ORDER_DISABLED",
        error: "Запити під замовлення тимчасово недоступні",
      });
    }

    if (req.auth && req.auth.role !== "CLIENT") {
      return res.status(403).json({
        success: false,
        code: "CLIENT_ACCOUNT_REQUIRED",
        error: "Ця форма доступна покупцям",
      });
    }

    if (req.auth?.mustChangePassword) {
      return res.status(403).json({
        success: false,
        code: "PASSWORD_CHANGE_REQUIRED",
        error: "Потрібно змінити пароль",
      });
    }

    try {
      const context = await availability(req);

      const inquiry = await create({
        input: req.body,
        // Never accept userId, source or price from JSON.
        userId: req.auth?.userId ?? null,
        source: "WEBSITE",
        availabilityContext: context,
      });

      return res.status(201).json({
        success: true,
        inquiry,
      });
    } catch (error) {
      const allowedStatuses = new Set([
        400, 403, 409, 429, 503,
      ]);
      const status = allowedStatuses.has(error?.statusCode)
        ? error.statusCode : 500;

      if (status === 500) {
        // No personal data or submitted request body in logs.
        console.error("Special-order inquiry: internal failure");
      }

      return res.status(status).json({
        success: false,
        code: status === 500
          ? "SPECIAL_ORDER_INTERNAL_ERROR"
          : (error.code || "SPECIAL_ORDER_ERROR"),
        error: status === 500
          ? "Не вдалося створити заявку"
          : error.message,
      });
    }
  };
}

export const createSpecialOrderInquiryHandler =
  makeSpecialOrderInquiryHandler();
