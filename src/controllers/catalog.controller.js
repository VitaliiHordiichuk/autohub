import { PublicCatalogService } from "../services/PublicCatalogService.js";
import { CustomerPricingService } from "../services/CustomerPricingService.js";

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
    const pricingContext = await CustomerPricingService.getContext(req.auth?.userId ?? null);
    const result = await PublicCatalogService.getCategoryProducts({
      slug: req.params.slug, locale: req.query.locale, page: req.query.page, pricingContext,
    });
    if (!result) return res.status(404).json({ success: false, error: "Категорію не знайдено" });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Ошибка товаров категории:", error);
    return res.status(500).json({ success: false, error: "Не вдалося завантажити товари" });
  }
}
