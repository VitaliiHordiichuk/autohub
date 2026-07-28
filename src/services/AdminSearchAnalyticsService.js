import {
  AdminSearchAnalyticsRepository,
} from "../repositories/AdminSearchAnalyticsRepository.js";


const ALLOWED_DAYS = new Set([
  7,
  30,
  90,
  365,
]);

const ALLOWED_STATUSES = new Set([
  "ALL",
  "FOUND",
  "NOT_FOUND",
]);

const ALLOWED_LIMITS = new Set([
  25,
  50,
  100,
]);


function positiveInteger(
  value,
  fallback
) {
  const numeric = Number(value);

  if (
    !Number.isInteger(numeric) ||
    numeric <= 0
  ) {
    return fallback;
  }

  return numeric;
}


function cleanSearch(value) {
  const search = String(
    value ?? ""
  ).trim();

  return search
    ? search.slice(0, 150)
    : "";
}


export function normalizeAnalyticsQuery(
  query = {}
) {
  const requestedDays =
    positiveInteger(
      query.days,
      30
    );

  const requestedLimit =
    positiveInteger(
      query.limit,
      25
    );

  const status = String(
    query.status || "ALL"
  )
    .trim()
    .toUpperCase();

  return {
    days:
      ALLOWED_DAYS.has(
        requestedDays
      )
        ? requestedDays
        : 30,

    status:
      ALLOWED_STATUSES.has(
        status
      )
        ? status
        : "ALL",

    search:
      cleanSearch(
        query.search
      ),

    page:
      Math.min(
        positiveInteger(
          query.page,
          1
        ),
        100000
      ),

    limit:
      ALLOWED_LIMITS.has(
        requestedLimit
      )
        ? requestedLimit
        : 25,
  };
}


export const AdminSearchAnalyticsService = {
  async getDashboard(query) {
    const filters =
      normalizeAnalyticsQuery(
        query
      );

    const dashboard =
      await AdminSearchAnalyticsRepository
        .getDashboard(filters);

    return {
      filters,
      ...dashboard,
    };
  },
};
