import { PublicSeoService } from "../services/PublicSeoService.js";

export async function getSeoProduct(req, res) {
  try {
    const result = await PublicSeoService.getProduct({
      article: req.params.article,
      locale: req.query.locale,
    });
    if (!result) {
      return res.status(404).json({ success: false, error: "Товар не знайдено" });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Помилка SEO-даних товару:", error);
    return res.status(500).json({ success: false, error: "Не вдалося завантажити SEO-дані товару" });
  }
}

export async function getSeoSitemap(_req, res) {
  try {
    return res.json({ success: true, ...(await PublicSeoService.getSitemap()) });
  } catch (error) {
    console.error("Помилка SEO sitemap:", error);
    return res.status(500).json({ success: false, error: "Не вдалося сформувати sitemap" });
  }
}

export async function getSeoBrand(req, res) {
  try {
    const result = await PublicSeoService.getBrand({
      slug: req.params.slug,
      locale: req.query.locale,
      page: req.query.page,
    });
    if (!result) {
      return res.status(404).json({ success: false, error: "Бренд не знайдено" });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Помилка SEO-сторінки бренду:", error);
    return res.status(500).json({ success: false, error: "Не вдалося завантажити бренд" });
  }
}
