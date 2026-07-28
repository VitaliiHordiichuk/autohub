import {
  AdminSearchAnalyticsService,
} from "../services/AdminSearchAnalyticsService.js";


export async function getSearchAnalytics(
  req,
  res
) {
  try {
    const result =
      await AdminSearchAnalyticsService
        .getDashboard(
          req.query
        );

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error(
      "Ошибка получения поисковой аналитики:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Не удалось получить поисковую аналитику",
    });
  }
}
