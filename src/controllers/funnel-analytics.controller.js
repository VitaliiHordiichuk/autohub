import {
  FunnelAnalyticsService,
  normalizePublicFunnelEvent,
} from "../services/FunnelAnalyticsService.js";


export async function recordFunnelEvent(
  req,
  res
) {
  try {
    const event =
      normalizePublicFunnelEvent(
        req.body
      );

    await FunnelAnalyticsService
      .recordEvent({
        req,
        ...event,
        requireIdentity: true,
      });

    return res.status(202).json({
      success: true,
    });
  } catch (error) {
    return res
      .status(
        error.statusCode || 500
      )
      .json({
        success: false,
        error: error.message,
      });
  }
}
