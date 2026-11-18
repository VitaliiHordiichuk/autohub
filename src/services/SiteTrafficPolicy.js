export const SITE_TRAFFIC_DAYS = 30;
export const SITE_TRAFFIC_ROUTES = new Set([
  "home", "catalog", "product", "brand", "search", "vin-request", "help",
  "contacts", "returns", "privacy", "cart", "checkout", "order-success",
  "login", "register", "forgot-password", "reset-password", "change-password",
  "account", "notifications",
]);

export function kyivDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftDay(day, offset) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}

export function trafficWindow(value, now = new Date()) {
  const maxDate = kyivDay(now), minDate = shiftDay(maxDate, 1 - SITE_TRAFFIC_DAYS);
  const date = value === undefined || value === "" ? maxDate : String(value);
  let valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  try { valid = valid && shiftDay(date, 0) === date; } catch { valid = false; }
  if (!valid || date < minDate || date > maxDate) {
    const error = new Error("Оберіть день у межах останніх 30 днів");
    error.statusCode = 400;
    throw error;
  }
  return { date, minDate, maxDate, timeZone: "Europe/Kyiv" };
}

// $1 is the retention worker's fixed run timestamp. Keep today plus 29 full
// Kyiv calendar days, including DST days of 23/25 hours.
export const SITE_TRAFFIC_RETENTION_PREDICATE = "t.created_at < (((($1::timestamptz AT TIME ZONE 'Europe/Kyiv')::date - 29)::timestamp) AT TIME ZONE 'Europe/Kyiv')";
