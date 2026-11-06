import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTelegramArticles, escapeTelegramHtml, formatTelegramProduct,
  formatTelegramBatch, formatTelegramInputError, formatTelegramHelp,
  formatTelegramOwnStockVariants,
} from "./TelegramCatalogFormatter.js";

const card = {
  product: { article: "A2711800109", name: "Фильтр <Mercedes> & масло" },
  offers: [
    { sourceType: "OWN_STOCK", quantity: 2, displayQuantity: "2",
      retailPrice: 950, isAvailable: true, warehouseCity: "Харків" },
    { sourceType: "SUPPLIER", quantity: 7, displayQuantity: ">5",
      retailPrice: 880, isAvailable: true, availabilityText: "Доставка 2 дні" },
    { sourceType: "OWN_STOCK", quantity: 0, retailPrice: 20, isAvailable: false },
  ],
  replacements: [{ product: { article: "A2711800209" },
    offers: [{ sourceType: "OWN_STOCK", quantity: 1, retailPrice: 1000, isAvailable: true }] }],
  analogs: [{ product: { article: "HU7185X" },
    offers: [{ sourceType: "SUPPLIER", quantity: 3, retailPrice: 650, isAvailable: true }] }],
};

test("один номер с пробелами и кириллической А остаётся одним артикулом", () => {
  assert.deepEqual(parseTelegramArticles("а 271-180 01 09").articles, ["а 271-180 01 09"]);
});

test("список до 20 номеров, дедупликация нормализованных обозначений", () => {
  const input = ["A2711800109", "а 271-180 01 09", "HU7185X"].join("\n");
  assert.deepEqual(parseTelegramArticles(input).articles, ["A2711800109", "HU7185X"]);
  const twenty = Array.from({ length: 20 }, (_, i) => "A" + String(i).padStart(10, "0"));
  assert.equal(parseTelegramArticles(twenty.join(";")).articles.length, 20);
  assert.equal(parseTelegramArticles([...twenty, "A9999999999"].join(",")).error, "TOO_MANY");
});

test("отклоняет пустой ввод, подозрительные строки и слишком длинные сообщения", () => {
  assert.equal(parseTelegramArticles("").error, "INPUT_LENGTH");
  assert.equal(parseTelegramArticles("Привет").error, "INVALID_ARTICLE");
  assert.equal(parseTelegramArticles("<script>777</script>").error, "INVALID_ARTICLE");
  assert.equal(parseTelegramArticles("A".repeat(2501)).error, "INPUT_LENGTH");
  assert.match(formatTelegramInputError("TOO_MANY").text, /20/);
  assert.match(formatTelegramHelp().text, /MAKA/);
});

test("раздельно показывает MAKA и поставщиков, без недоступных предложений", () => {
  const response = formatTelegramProduct({ query: "A2711800109", card, locale: "uk" });
  assert.match(response.text, /Склад MAKA/);
  assert.match(response.text, /Постачальники/);
  assert.match(response.text, /950/);
  assert.match(response.text, /880/);
  assert.doesNotMatch(response.text, /20 грн/);
  assert.match(response.text, /Харків/);
  assert.match(response.text, /Доставка 2 дні/);
  assert.match(response.reply_markup.inline_keyboard[0][0].url, /^https:\/\/maka\.com\.ua\/uk\/product\//);
});

test("аналог, замена и безопасный HTML вывод", () => {
  const response = formatTelegramProduct({ query: "A2711800109", card,
    replacementArticle: "A2711800209" });
  assert.match(response.text, /Заміни/);
  assert.match(response.text, /Аналоги/);
  assert.match(response.text, /HU7185X/);
  assert.match(response.text, /Заміна номера/);
  assert.match(response.text, /&lt;Mercedes&gt; &amp;/);
  assert.doesNotMatch(response.text, /<Mercedes>/);
  assert.equal(escapeTelegramHtml('"<tag>"'), "&quot;&lt;tag&gt;&quot;");
});

test("не выводит priceMatrix ни в одном публичном ответе", () => {
  const enriched = { ...card, offers: [{ ...card.offers[0],
    priceMatrix: [{ name: "Wholesale", price: 123 }] }] };
  const response = formatTelegramProduct({ query: "A2711800109", card: enriched });
  assert.doesNotMatch(response.text, /Wholesale|123/);
});

test("краткие ответы на 20 номеров разбиваются на пять записей", () => {
  const examples = Array.from({ length: 20 }, (_, i) => formatTelegramProduct({
    query: String(i), card, compact: true,
  }));
  const batches = formatTelegramBatch(examples);
  assert.equal(batches.length, 4);
  assert.ok(batches.every((chunk) => chunk.text.length < 4096));
  assert.ok(batches.every((chunk) => chunk.parse_mode === "HTML"));
});


test("приветствие персонализировано, но имя экранируется перед Telegram HTML", () => {
  const hello = formatTelegramHelp({ firstName: "Олександр", locale: "uk" });
  assert.match(hello.text, /Привіт, Олександр!/);
  assert.equal(hello.parse_mode, "HTML");
  assert.match(formatTelegramHelp({ firstName: "Іван", locale: "ru" }).text, /Привіт, Іван!/);
  assert.match(formatTelegramHelp({ firstName: "Alex", locale: "en" }).text, /Hello, Alex!/);
  const unsafe = formatTelegramHelp({ firstName: "<b>Іван & Co</b>", locale: "uk" });
  assert.match(unsafe.text, /&lt;b&gt;Іван &amp; Co&lt;\/b&gt;/);
  assert.doesNotMatch(unsafe.text, /<b>Іван/);
  assert.match(formatTelegramHelp().text, /Привіт! Я MAKAtron/);
});

test("українська — типова мова, англійська — лише після вибору", () => {
  const en = formatTelegramProduct({ query:"A2711800109", card, locale:"en" });
  assert.match(en.text, /MAKA warehouse/);
  assert.match(en.text, /Suppliers \(on order\)/);
  assert.match(en.text, /UAH/);
  assert.doesNotMatch(en.text, /Поставщики|Замены|Склад MAKA/);
  assert.match(en.reply_markup.inline_keyboard[0][0].url, /\/en\/product\//);
  assert.match(formatTelegramInputError("TOO_MANY", "en").text, /up to 20/);
  assert.match(formatTelegramHelp({ locale:"en" }).text, /Send a part number/);
  assert.match(formatTelegramHelp({ locale:"ru" }).text, /Привіт/);
  assert.match(formatTelegramInputError("INVALID_ARTICLE", "ru").text, /Надішліть артикул/);
});


test("shared-site stock response groups available variants by warehouse city with linked articles and quantities", () => {
  const cards = [
    { product: { id: 1, article: "A2711800109", name: "Масляний фільтр" },
      offers: [
        { id: 1, sourceType: "OWN_STOCK", warehouseCity: "Харків",
          isAvailable: true, quantity: 9, displayQuantity: ">5", retailPrice: 1380.96 },
        { id: 2, sourceType: "SUPPLIER", isAvailable: true,
          quantity: 99, retailPrice: 100 },
      ] },
    { product: { id: 2, article: "A271180010990", name: "Фільтр масляний" },
      offers: [{ id: 3, sourceType: "OWN_STOCK", warehouseCity: "Харків",
        isAvailable: true, quantity: 2, displayQuantity: "2", retailPrice: 1499 }] },
    { product: { id: 3, article: "HU718/5X", name: "Аналог без залишку" },
      offers: [
        { id: 4, sourceType: "OWN_STOCK", warehouseCity: "Харків",
          isAvailable: false, quantity: 0, retailPrice: 750 },
        { id: 5, sourceType: "SUPPLIER", isAvailable: true,
          quantity: 10, retailPrice: 650 },
      ] },
  ];
  const out = formatTelegramOwnStockVariants({ query: "2711800109", cards, locale: "uk" }).text;
  assert.match(out, /🏬 <b>Склад Харків<\/b>/);
  assert.match(out, /href="https:\/\/maka\.com\.ua\/uk\/product\/A2711800109"/);
  assert.match(out, /href="https:\/\/maka\.com\.ua\/uk\/product\/A271180010990"/);
  assert.match(out, /Масляний фільтр/);
  assert.match(out, /Фільтр масляний/);
  assert.match(out, /1[\s\u00a0]380,96 грн/);
  assert.match(out, /1[\s\u00a0]499 грн/);
  assert.match(out, /🟢 <b>В наявності: &gt;5 шт\.<\/b>/);
  assert.match(out, /🟢 <b>В наявності: 2 шт\.<\/b>/);
  assert.doesNotMatch(out, /HU718\/5X|Аналог без залишку|650 грн|100 грн|Склад MAKA|Інші номери/);
  assert.equal((out.match(/🏬/g) || []).length, 1);
  assert.equal((out.match(/🔎/g) || []).length, 2);
});

test("only actual site OWN_STOCK offers appear, grouped by each city; do not invent a city", () => {
  const cards = [
    { product: { article: "A1673200503", name: "<Підвіска> & деталь" },
      offers: [
        { sourceType: "OWN_STOCK", isAvailable: true, quantity: 1,
          retailPrice: 189741.3, warehouseCity: "Київ" },
        { sourceType: "OWN_STOCK", isAvailable: true, quantity: 2,
          retailPrice: 188000, warehouseCity: "Харків" },
        { sourceType: "OWN_STOCK", isAvailable: true, quantity: -1,
          retailPrice: 1, warehouseCity: "Одеса" },
      ] },
    { product: { article: "A167320050380", name: "Заміна" },
      offers: [{ sourceType: "OWN_STOCK", isAvailable: true,
        quantity: 1, retailPrice: 200000 }] },
  ];
  const text = formatTelegramOwnStockVariants({ query: "A1673200503", cards }).text;
  assert.match(text, /Склад Київ/);
  assert.match(text, /Склад Харків/);
  assert.match(text, /🏬 <b>Склад<\/b>/);
  assert.doesNotMatch(text, /Склад Одеса/);
  assert.match(text, /&lt;Підвіска&gt; &amp; деталь/);
  assert.equal((text.match(/🔎/g) || []).length, 3);
});

test("without in-stock own offers shared results explicitly say no stock, not suppliers or missing variants", () => {
  const cards = [
    { product: { article: "HU718/5X", name: "Фільтр" },
      offers: [{ sourceType: "SUPPLIER", quantity: 5, retailPrice: 600, isAvailable: true }] },
    { product: { article: "A271180010990", name: "Фільтр" },
      offers: [{ sourceType: "OWN_STOCK", quantity: 0, retailPrice: 600, isAvailable: false }] },
  ];
  const out = formatTelegramOwnStockVariants({ query: "2711800109", cards }).text;
  assert.match(out, /2711800109.*немає в наявності на наших складах/);
  assert.doesNotMatch(out, /HU718|A271180010990|600 грн/);
  const en = formatTelegramOwnStockVariants({
    query: "2711800109", cards: [{ product: { article: "A2711800109", name: "Oil filter" },
      offers: [{ sourceType: "OWN_STOCK", isAvailable: true, quantity: 1,
        retailPrice: 100, warehouseCity: "Kharkiv" }] }], locale: "en",
  }).text;
  assert.match(en, /Warehouse Kharkiv/);
  assert.match(en, /In stock: 1 pcs/);
  assert.match(en, /100 UAH/);
});

test("Telegram batch safely splits many in-stock variants without dropping HTML links", () => {
  const long = Array.from({ length: 70 }, (_, i) =>
    '🔎 <a href="https://maka.com.ua/uk/product/A' + String(i).padStart(10, "0")
      + '">A' + String(i).padStart(10, "0")
      + '</a> — ' + "Фільтр ".repeat(14)
      + '\n💰 <b>1 380 грн</b> 🟢 <b>В наявності: 2 шт.</b>'
  ).join("\n\n");
  const chunks = formatTelegramBatch([{ text: "🏬 <b>Склад Харків</b>\n" + long }]);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.text.length < 4096));
  assert.ok(chunks.every(chunk => chunk.parse_mode === "HTML"));
  const allText = chunks.map(chunk => chunk.text).join("\n");
  for (let i = 0; i < 70; i++) {
    assert.match(allText, new RegExp("A" + String(i).padStart(10, "0")));
  }
  assert.equal((allText.match(/🔎/g) || []).length, 70);
});
