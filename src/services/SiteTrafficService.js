import { createHmac } from "node:crypto";
import { SiteTrafficRepository } from "../repositories/SiteTrafficRepository.js";
import { shouldRecordSearchAnalytics, resolveAnalyticsSessionId } from "./SearchAnalyticsService.js";
import { SITE_TRAFFIC_ROUTES, trafficWindow, kyivDay } from "./SiteTrafficPolicy.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enabled = () => process.env.SITE_TRAFFIC_ENABLED === "true";
const counters = new Map();

export function normalizeSitePageView(body = {}) {
  if (!body || typeof body !== "object" || !uuid.test(body.eventId || "") || !uuid.test(body.visitId || "") ||
      !SITE_TRAFFIC_ROUTES.has(body.route) || !["uk", "ru", "en"].includes(body.locale)) {
    const error = new Error("Некоректна подія відвідування"); error.statusCode = 400; throw error;
  }
  return { id: body.eventId, visitId: body.visitId, route: body.route, locale: body.locale };
}

function key(kind, value) {
  const secret = process.env.SEARCH_ANALYTICS_HASH_SECRET || process.env.AUTH_JWT_SECRET || "maka-site-traffic";
  return createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
}

export const SiteTrafficService = {
  async record(req, body, repository = SiteTrafficRepository) {
    if (!enabled() || !shouldRecordSearchAnalytics(req)) return false;
    const visitor = resolveAnalyticsSessionId(req);
    if (!visitor || visitor.length < 12) return false;
    const event = normalizeSitePageView(body);
    const visitorKey = key("visitor", visitor), now = Date.now();
    let counter = counters.get(visitorKey);
    if (!counter || now - counter.at >= 60_000) {
      counter = { at: now, count: 0 };
      if (counters.size >= 5000) counters.delete(counters.keys().next().value);
      counters.set(visitorKey, counter);
    }
    // Bounded per-browser noise protection, not proof of human identity.
    if (++counter.count > 90) return false;
    return repository.record({ id: event.id, visitorKey,
      visitKey: key("visit", `${visitor}:${event.visitId}`), route: event.route, locale: event.locale });
  },

  async dashboard(query = {}, now = new Date(), repository = SiteTrafficRepository) {
    const window = trafficWindow(query.date, now);
    if (!enabled()) return { window, summary: { visitors: 0, visits: 0, pageViews: 0 },
      startedAt: null, collectionEnabled: false, available: false };
    const result = await repository.dashboard(window.date);
    return { ...result, window, collectionEnabled: true,
      available: Boolean(result.startedAt && window.date >= kyivDay(new Date(result.startedAt))) };
  },
};
