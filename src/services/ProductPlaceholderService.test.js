import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { ProductPlaceholderService } from "./ProductPlaceholderService.js";

test("визначає шаблон за назвою та категорією", () => {
  assert.equal(ProductPlaceholderService.templateFor({ name: "Фільтр мастила" }), "filter");
  assert.equal(ProductPlaceholderService.templateFor({ name: "Кільце сальника" }), "seal");
  assert.equal(ProductPlaceholderService.templateFor({ category: "Прокладки двигуна" }), "gasket");
  assert.equal(ProductPlaceholderService.templateFor({ productType: "Timing belt" }), "belt");
  assert.equal(ProductPlaceholderService.templateFor({ name: "Кронштейн" }), "default");
});

test("повертає реальні фото без заглушки", () => {
  const result = ProductPlaceholderService.getProductImage({
    article: "A2711800109",
    imageUrls: ["https://cdn.example.com/product.webp"],
  });

  assert.deepEqual(result, {
    imageUrl: "https://cdn.example.com/product.webp",
    imageUrls: ["https://cdn.example.com/product.webp"],
    hasRealImage: true,
    isPlaceholder: false,
  });
});

test("створює стабільне URL заглушки з нормалізованого артикула", () => {
  const result = ProductPlaceholderService.getProductImage({
    article: "HU718/5X",
    article_normalized: "HU7185X",
    imageUrls: [],
  });

  assert.equal(result.imageUrl, "/api/products/HU7185X/placeholder");
  assert.deepEqual(result.imageUrls, []);
  assert.equal(result.hasRealImage, false);
  assert.equal(result.isPlaceholder, true);
});

test("генерує безпечне WebP 800 на 800 пікселів", async () => {
  const product = {
    article: "A2143571500<script>",
    brand: "Mercedes-Benz & MAKA",
    category: "Сальники",
    name: "Захисне кільце <сальника> півосі",
  };
  const first = await ProductPlaceholderService.generatePlaceholder(product);
  const second = await ProductPlaceholderService.generatePlaceholder(product);
  const metadata = await sharp(first.buffer).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 800);
  assert.equal(metadata.height, 800);
  assert.equal(first.template, "seal");
  assert.equal(first.etag, second.etag);
  assert.equal(first.buffer, second.buffer);
});
