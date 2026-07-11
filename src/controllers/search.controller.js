import { SearchService } from "../services/SearchService.js";
import { ProductCardService } from "../services/ProductCardService.js";

export async function searchByArticle(req, res) {
  try {
    const article = req.query.article;

    if (!article) {
      return res.status(400).json({
        success: false,
        error: "Параметр article обязателен",
      });
    }

    const searchResult =
      await SearchService.searchByArticle(article);

    if (!searchResult.found) {
      return res.status(404).json({
        success: false,
        query: article,
        normalized: searchResult.normalized,
        message: "Товар не найден",
      });
    }

    const productCard = searchResult.exactProduct
      ? await ProductCardService.build(
          searchResult.exactProduct
        )
      : null;

    return res.json({
      success: true,
      query: searchResult.query,
      normalized: searchResult.normalized,
      searchedArticle:
        searchResult.searchedArticle ??
        searchResult.normalized,
      rule: searchResult.rule,
      parsed: searchResult.parsed ?? null,
      family: searchResult.family,
      productCard,
    });
  } catch (error) {
    console.error("Ошибка поиска:", error);

    return res.status(500).json({
      success: false,
      error: "Внутренняя ошибка сервера",
    });
  }
}