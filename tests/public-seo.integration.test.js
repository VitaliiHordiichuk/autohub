import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { PublicSeoService } from "../src/services/PublicSeoService.js";
import { SiteLanguageService } from "../src/services/SiteLanguageService.js";
import { SEARCH_FIXTURE } from "./helpers/search-fixture.js";

after(async () => {
  await pool.end();
});

test("російська мова доступна публічно та стоїть останньою", async () => {
  const result = await SiteLanguageService.getPublicLanguages();
  assert.equal(result.defaultLanguage, "uk");
  assert.deepEqual(result.languages.map((item) => item.code), ["uk", "en", "ru"]);
  assert.equal(result.languages.at(-1).nativeName, "русский");
});

test("SEO товару містить Product-дані, категорію, зв'язки та складські пропозиції", async () => {
  const result = await PublicSeoService.getProduct({
    article: SEARCH_FIXTURE.originalArticle,
    locale: "ru",
  });
  assert.ok(result);
  assert.equal(result.locale, "ru");
  assert.equal(result.product.article, SEARCH_FIXTURE.originalArticle);
  assert.ok(result.product.name);
  assert.ok(result.product.category);
  assert.ok(result.product.category.slug);
  assert.ok(result.alternativeArticles.includes(SEARCH_FIXTURE.originalWithoutPrefix));
  assert.ok(result.analogs.some((item) => item.article === SEARCH_FIXTURE.analogArticle));
  assert.ok(Array.isArray(result.replacements));
  assert.ok(Array.isArray(result.offers));
  if (result.offer) assert.ok(Number(result.offer.price) > 0);
  if (result.offers[0]) {
    assert.ok(result.offers[0].sourceLabel);
    assert.ok(result.offers[0].displayQuantity);
  }
  assert.ok(result.analogArticles.includes(SEARCH_FIXTURE.analogArticle));
});

test("SEO sitemap містить товар і робочу сторінку бренду", async () => {
  const sitemap = await PublicSeoService.getSitemap();
  const product = sitemap.products.find((item) => item.article === SEARCH_FIXTURE.originalArticle);
  assert.ok(product);
  assert.ok(Array.isArray(product.imageUrls));
  assert.equal(product.imageUrl, product.imageUrls[0] || null);
  const brand = sitemap.brands.find((item) => item.name === "Mercedes-Benz");
  assert.ok(brand);

  const brandPage = await PublicSeoService.getBrand({
    slug: brand.slug,
    locale: "uk",
    page: 1,
  });
  assert.ok(brandPage);
  assert.equal(brandPage.brand.name, "Mercedes-Benz");
  assert.ok(brandPage.pagination.total > 0);
  assert.ok(brandPage.products.length > 0);
});
