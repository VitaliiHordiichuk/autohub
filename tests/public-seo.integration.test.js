import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { AdminWarehouseOfferRepository } from "../src/repositories/AdminWarehouseOfferRepository.js";
import { ProductImageService } from "../src/services/ProductImageService.js";
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

test("SEO-зображення товару використовують Merchant CLEAN, потім ORIGINAL, але не сайтову версію", async () => {
  const productResult = await pool.query(`
    SELECT id
    FROM products
    WHERE article_normalized = $1
    LIMIT 1
  `, [SEARCH_FIXTURE.originalNormalized]);
  const productId = productResult.rows[0]?.id;
  assert.ok(productId, "Тестовий товар повинен існувати");

  const siteUrl = "https://images.example.test/processed/seo-site-branded.webp";
  const cleanUrl = "https://images.example.test/merchant/seo-clean-1500.webp";
  const originalUrl = "https://images.example.test/originals/seo-original.jpg";
  const imageResult = await pool.query(`
    INSERT INTO product_images(
      product_id, url, source, priority, original_url, merchant_url_1500
    )
    VALUES($1, $2, 'R2', -1000, $3, $4)
    RETURNING id
  `, [productId, siteUrl, originalUrl, cleanUrl]);
  const imageId = imageResult.rows[0].id;

  try {
    const withClean = await PublicSeoService.getProduct({
      article: SEARCH_FIXTURE.originalArticle,
      locale: "uk",
    });
    assert.equal(withClean.product.seoImages[0], cleanUrl);
    assert.equal(withClean.product.images[0], siteUrl);
    assert.equal(withClean.product.images.includes(cleanUrl), false);

    await pool.query(`
      UPDATE product_images SET merchant_url_1500 = NULL WHERE id = $1
    `, [imageId]);
    const withOriginal = await PublicSeoService.getProduct({
      article: SEARCH_FIXTURE.originalArticle,
      locale: "uk",
    });
    assert.equal(withOriginal.product.seoImages[0], originalUrl);
    assert.equal(withOriginal.product.images[0], siteUrl);

    await pool.query(`
      UPDATE product_images SET original_url = NULL WHERE id = $1
    `, [imageId]);
    const withoutSafeVersion = await PublicSeoService.getProduct({
      article: SEARCH_FIXTURE.originalArticle,
      locale: "uk",
    });
    assert.equal(withoutSafeVersion.product.seoImages.includes(siteUrl), false);
    assert.equal(withoutSafeVersion.product.images[0], siteUrl);
  } finally {
    await pool.query("DELETE FROM product_images WHERE id = $1", [imageId]);
  }
});

test("SEO sitemap містить товар і робочу сторінку бренду", async () => {
  const sitemap = await PublicSeoService.getSitemap();
  const product = sitemap.products.find((item) => item.article === SEARCH_FIXTURE.originalArticle);
  assert.ok(product);
  assert.ok(Array.isArray(product.imageUrls));
  assert.equal(product.imageUrl, product.imageUrls[0] || null);
  assert.equal(product.hasRealImage, product.imageUrls.length > 0);
  assert.equal(typeof product.isAvailable, "boolean");
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

  const lastBrandPage = await PublicSeoService.getBrand({
    slug: brand.slug,
    locale: "uk",
    page: brandPage.pagination.pages,
  });
  assert.ok(lastBrandPage);
  assert.equal(lastBrandPage.pagination.page, brandPage.pagination.pages);

  assert.equal(await PublicSeoService.getBrand({
    slug: brand.slug,
    locale: "uk",
    page: brandPage.pagination.pages + 1,
  }), null);

  for (const page of [0, -1, 1.5, "abc", "", ["2", "3"]]) {
    assert.equal(await PublicSeoService.getBrand({
      slug: brand.slug,
      locale: "uk",
      page,
    }), null);
  }
});

test("image sitemap використовує лише CLEAN або original зображення", async () => {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const articles = {
    one: `SEOIMAGEONE${suffix}`,
    multiple: `SEOIMAGEMULTI${suffix}`,
    unsafe: `SEOIMAGEUNSAFE${suffix}`,
  };
  const productIds = [];
  const urls = {
    oneClean: `https://images.example.test/merchant/${suffix}-one-clean.webp`,
    multiClean: `https://images.example.test/merchant/${suffix}-multi-clean.webp`,
    multiOriginal: `https://images.example.test/originals/${suffix}-multi-original.jpg`,
    secondClean: `https://images.example.test/merchant/${suffix}-second-clean.webp`,
    oneProcessed: `https://images.example.test/processed/${suffix}-one-branded.webp`,
    multiProcessed: `https://images.example.test/processed/${suffix}-multi-branded.webp`,
    unsafeProcessed: `https://images.example.test/processed/${suffix}-unsafe-branded.webp`,
  };

  try {
    const products = await pool.query(`
      INSERT INTO products(article, article_normalized, name, is_active)
      VALUES
        ($1, $1, 'SEO image one fixture', TRUE),
        ($2, $2, 'SEO image multiple fixture', TRUE),
        ($3, $3, 'SEO image unsafe fixture', TRUE)
      RETURNING id,article
    `, [articles.one, articles.multiple, articles.unsafe]);
    const productIdByArticle = new Map(products.rows.map((row) => [row.article, Number(row.id)]));
    productIds.push(...productIdByArticle.values());

    await pool.query(`
      INSERT INTO product_images(
        product_id, url, priority, merchant_url_1500, original_url
      )
      VALUES
        ($1, $4, 0, $5, $6),
        ($2, $7, 0, $8, $9),
        ($2, $10, 1, NULL, $11),
        ($2, $12, 2, $13, NULL),
        ($2, $14, 3, $8, $15),
        ($2, $16, 4, NULL, NULL),
        ($3, $17, 0, NULL, NULL)
    `, [
      productIdByArticle.get(articles.one),
      productIdByArticle.get(articles.multiple),
      productIdByArticle.get(articles.unsafe),
      urls.oneProcessed,
      urls.oneClean,
      `https://images.example.test/originals/${suffix}-one-original.jpg`,
      urls.multiProcessed,
      urls.multiClean,
      `https://images.example.test/originals/${suffix}-multi-first-original.jpg`,
      `https://images.example.test/processed/${suffix}-fallback-branded.webp`,
      urls.multiOriginal,
      `https://images.example.test/processed/${suffix}-second-branded.webp`,
      urls.secondClean,
      `https://images.example.test/processed/${suffix}-duplicate-branded.webp`,
      `https://images.example.test/originals/${suffix}-duplicate-original.jpg`,
      urls.unsafeProcessed,
      urls.unsafeProcessed,
    ]);

    const sitemap = await PublicSeoService.getSitemap();
    const byArticle = new Map(sitemap.products.map((product) => [product.article, product]));

    assert.deepEqual(byArticle.get(articles.one).imageUrls, [urls.oneClean]);
    assert.deepEqual(byArticle.get(articles.multiple).imageUrls, [
      urls.multiClean,
      urls.multiOriginal,
      urls.secondClean,
    ]);
    assert.deepEqual(byArticle.get(articles.unsafe).imageUrls, []);
    assert.equal(byArticle.get(articles.unsafe).imageUrl, null);
    assert.equal(byArticle.get(articles.unsafe).hasRealImage, false);

    for (const product of [
      byArticle.get(articles.one),
      byArticle.get(articles.multiple),
      byArticle.get(articles.unsafe),
    ]) {
      assert.equal(product.imageUrls.some((url) => url.includes("/processed/")), false);
    }
  } finally {
    if (productIds.length) {
      await pool.query("DELETE FROM product_images WHERE product_id = ANY($1::integer[])", [productIds]);
      await pool.query("DELETE FROM product_categories WHERE product_id = ANY($1::integer[])", [productIds]);
      await pool.query("DELETE FROM products WHERE id = ANY($1::integer[])", [productIds]);
    }
  }
});

test("lastmod товару відображає всі публічні зміни та стабільний без змін", async () => {
  const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  const article = `SEOLASTMOD${suffix}`;
  const oldTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let productId;
  let offerId;
  let firstImageId;
  let secondImageId;
  let addedImageId;

  const sitemapLastmod = async () => {
    const sitemap = await PublicSeoService.getSitemap();
    const product = sitemap.products.find((item) => item.article === article);
    assert.ok(product, "Тестовий товар має бути в sitemap");
    const timestamp = new Date(product.updatedAt).getTime();
    assert.ok(Number.isFinite(timestamp), "lastmod має бути валідною датою");
    return timestamp;
  };

  const expectAdvance = async (previous, label, change) => {
    await pool.query("SELECT pg_sleep(0.01)");
    await change();
    const next = await sitemapLastmod();
    assert.ok(next > previous, `${label} має оновити lastmod`);
    return next;
  };

  try {
    const product = await pool.query(`
      INSERT INTO products(
        article, article_normalized, name, is_active, created_at, updated_at
      )
      VALUES($1, $1, 'SEO lastmod fixture', TRUE, $2, $2)
      RETURNING id
    `, [article, oldTimestamp]);
    productId = Number(product.rows[0].id);

    const offer = await pool.query(`
      INSERT INTO product_offers(
        product_id, quantity, purchase_price, retail_price,
        source_type, is_available, is_hidden, created_at, updated_at
      )
      VALUES($1, 2, 100, 150, 'OWN_STOCK', TRUE, FALSE, $2, $2)
      RETURNING id
    `, [productId, oldTimestamp]);
    offerId = Number(offer.rows[0].id);

    const images = await pool.query(`
      INSERT INTO product_images(product_id, url, priority, created_at)
      VALUES
        ($1, $2, 0, $4),
        ($1, $3, 1, $4)
      RETURNING id
    `, [
      productId,
      `https://images.example.test/${suffix}-one.webp`,
      `https://images.example.test/${suffix}-two.webp`,
      oldTimestamp,
    ]);
    firstImageId = Number(images.rows[0].id);
    secondImageId = Number(images.rows[1].id);

    await pool.query(`
      INSERT INTO product_translations(
        product_id, language_code, name, description, provider,
        source_language, is_verified, created_at, updated_at
      )
      VALUES
        ($1, 'uk', 'Тест lastmod', 'Опис', 'MANUAL', 'uk', TRUE, $2, $2),
        ($1, 'ru', 'Тест lastmod', 'Описание', 'MANUAL', 'ru', TRUE, $2, $2),
        ($1, 'en', 'Lastmod test', 'Description', 'MANUAL', 'en', TRUE, $2, $2)
    `, [productId, oldTimestamp]);

    let lastmod = await sitemapLastmod();

    lastmod = await expectAdvance(lastmod, "Зміна ціни", () => pool.query(`
      UPDATE product_offers
      SET retail_price = retail_price + 1, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1
    `, [productId]));

    lastmod = await expectAdvance(lastmod, "Зміна ручної ціни", async () => {
      const updated = await AdminWarehouseOfferRepository.setManualPrice({
        offerId,
        price: 175,
      });
      assert.ok(updated.updated_at);
      assert.ok(updated.manual_price_updated_at);
    });

    lastmod = await expectAdvance(lastmod, "Приховування пропозиції", async () => {
      const updated = await AdminWarehouseOfferRepository.setVisibility({
        offerId,
        hidden: true,
      });
      assert.equal(updated.is_hidden, true);
      assert.ok(updated.hidden_at);
      assert.ok(updated.updated_at);
    });

    lastmod = await expectAdvance(lastmod, "Повернення прихованої пропозиції", async () => {
      const updated = await AdminWarehouseOfferRepository.setVisibility({
        offerId,
        hidden: false,
      });
      assert.equal(updated.is_hidden, false);
      assert.equal(updated.hidden_at, null);
      assert.ok(updated.updated_at);
    });

    lastmod = await expectAdvance(lastmod, "Зміна залишку", () => pool.query(`
      UPDATE product_offers
      SET quantity = quantity + 1, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1
    `, [productId]));

    lastmod = await expectAdvance(lastmod, "Зміна доступності", () => pool.query(`
      UPDATE product_offers
      SET is_available = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1
    `, [productId]));

    lastmod = await expectAdvance(lastmod, "Додавання фото", async () => {
      const added = await pool.query(`
        INSERT INTO product_images(product_id, url, priority)
        VALUES($1, $2, 2)
        RETURNING id
      `, [productId, `https://images.example.test/${suffix}-three.webp`]);
      addedImageId = Number(added.rows[0].id);
    });

    lastmod = await expectAdvance(lastmod, "Зміна головного фото", () => (
      ProductImageService.makePrimary(productId, secondImageId)
    ));

    lastmod = await expectAdvance(lastmod, "Видалення фото", async () => {
      await ProductImageService.remove(productId, addedImageId);
      addedImageId = null;
    });

    lastmod = await expectAdvance(lastmod, "Зміна ручної назви", () => pool.query(`
      UPDATE product_translations
      SET name = 'Оновлена ручна назва', provider = 'MANUAL', updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1 AND language_code = 'uk'
    `, [productId]));

    lastmod = await expectAdvance(lastmod, "Зміна опису", () => pool.query(`
      UPDATE product_translations
      SET description = 'Оновлений опис', updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1 AND language_code = 'uk'
    `, [productId]));

    lastmod = await expectAdvance(lastmod, "Зміна перекладів ru/en", () => pool.query(`
      UPDATE product_translations
      SET name = name || ' updated', updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1 AND language_code = ANY(ARRAY['ru', 'en']::varchar[])
    `, [productId]));

    const unchangedLastmod = await sitemapLastmod();
    assert.equal(unchangedLastmod, lastmod, "Повторний sitemap не має змінювати lastmod");
  } finally {
    if (productId) {
      if (addedImageId) {
        await pool.query("DELETE FROM product_images WHERE id = $1", [addedImageId]);
      }
      await pool.query("DELETE FROM product_translations WHERE product_id = $1", [productId]);
      await pool.query("DELETE FROM product_images WHERE id = ANY($1::integer[])", [[
        firstImageId,
        secondImageId,
      ].filter(Boolean)]);
      await pool.query("DELETE FROM product_offers WHERE product_id = $1", [productId]);
      await pool.query("DELETE FROM product_categories WHERE product_id = $1", [productId]);
      await pool.query("DELETE FROM products WHERE id = $1", [productId]);
    }
  }
});
