import { PublicCatalogService } from "../services/PublicCatalogService.js";
import { CustomerPricingService } from "../services/CustomerPricingService.js";
import { PublicAvailabilityContextService } from "../services/PublicAvailabilityContextService.js";
import { LegacyCatalogRedirectService } from "../services/LegacyCatalogRedirectService.js";

export async function getLegacyCatalogRedirect(req, res) {
  res.set("Cache-Control", "no-store");
  try {
    const redirect = await LegacyCatalogRedirectService.resolve(req.params.slug);
    return res.json({ success: true, redirect });
  } catch (error) {
    console.error("Ошибка перенаправления каталога:", error);
    return res.status(503).json({ success: false });
  }
}

export async function getCatalogTree(req, res) {
  try {
    const categories = await PublicCatalogService.getTree(req.query.locale);
    return res.json({ success: true, categories });
  } catch (error) {
    console.error("Ошибка каталога:", error);
    return res.status(500).json({ success: false, error: "Не вдалося завантажити каталог" });
  }
}

export async function getCategoryProducts(req, res) {
  try {
    res.set("Cache-Control", "private, no-store");
    const [pricingContext, availabilityContext] = await Promise.all([
      CustomerPricingService.getContext(req.auth?.userId ?? null),
      PublicAvailabilityContextService.fromRequest(req),
    ]);
    const result = await PublicCatalogService.getCategoryProducts({
      slug: req.params.slug, locale: req.query.locale, page: req.query.page,
      query: req.query.q, availability: req.query.availability,
      minPrice: req.query.minPrice, maxPrice: req.query.maxPrice,
      sort: req.query.sort, pricingContext, availabilityContext,
    });
    if (!result) return res.status(404).json({ success: false, error: "Категорію не знайдено" });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Ошибка товаров категории:", error);
    return res.status(500).json({ success: false, error: "Не вдалося завантажити товари" });
  }
}
