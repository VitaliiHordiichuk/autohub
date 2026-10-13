import { PublicAvailabilityContextService } from "../services/PublicAvailabilityContextService.js";
import { RecentlyViewedProductService } from "../services/RecentlyViewedProductService.js";

function errorResponse(res, error, fallback) {
  const requestedStatus = Number(error?.statusCode);
  const status = [400, 409].includes(requestedStatus) ? requestedStatus : 500;
  if (status === 500) console.error(fallback, error);
  return res.status(status).json({
    success: false,
    error: status === 400 ? error.message : fallback,
  });
}

function assertExpectedUser(req) {
  const raw = req.method === "PUT"
    ? req.body?.expectedUserId
    : req.query?.expectedUserId;
  const expectedUserId = Number(raw);
  if (!Number.isInteger(expectedUserId) || expectedUserId <= 0) {
    throw Object.assign(new Error("Потрібен коректний expectedUserId"), { statusCode: 400 });
  }
  if (expectedUserId !== Number(req.auth.userId)) {
    throw Object.assign(new Error("Обліковий запис змінився. Оновіть історію переглядів"), {
      statusCode: 409,
    });
  }
}

export async function listPublicRecentlyViewed(req, res) {
  try {
    res.set("Cache-Control", "private, no-store");
    const availabilityContext = await PublicAvailabilityContextService.fromRequest(req);
    const products = await RecentlyViewedProductService.listPublicCards({
      items: req.body?.items,
      locale: req.body?.locale,
      userId: req.auth?.userId ?? null,
      availabilityContext,
    });
    return res.json({ success: true, products });
  } catch (error) {
    return errorResponse(res, error, "Не вдалося завантажити нещодавно переглянуті товари");
  }
}

export async function listAccountRecentlyViewed(req, res) {
  try {
    assertExpectedUser(req);
    res.set("Cache-Control", "private, no-store");
    const availabilityContext = await PublicAvailabilityContextService.fromRequest(req);
    const products = await RecentlyViewedProductService.listAccount({
      userId: req.auth.userId,
      locale: req.query.locale,
      availabilityContext,
    });
    return res.json({ success: true, products });
  } catch (error) {
    return errorResponse(res, error, "Не вдалося завантажити історію переглядів");
  }
}

export async function mergeAccountRecentlyViewed(req, res) {
  try {
    assertExpectedUser(req);
    res.set("Cache-Control", "private, no-store");
    const availabilityContext = await PublicAvailabilityContextService.fromRequest(req);
    const products = await RecentlyViewedProductService.mergeAccount({
      userId: req.auth.userId,
      locale: req.body?.locale,
      items: req.body?.items,
      availabilityContext,
    });
    return res.json({ success: true, products });
  } catch (error) {
    return errorResponse(res, error, "Не вдалося синхронізувати історію переглядів");
  }
}

export async function clearAccountRecentlyViewed(req, res) {
  try {
    assertExpectedUser(req);
    await RecentlyViewedProductService.clearAccount({ userId: req.auth.userId });
    return res.json({ success: true });
  } catch (error) {
    return errorResponse(res, error, "Не вдалося очистити історію переглядів");
  }
}
