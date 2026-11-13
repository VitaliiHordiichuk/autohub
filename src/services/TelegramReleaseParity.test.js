import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  formatTelegramOwnStockVariants,
  formatTelegramBatch,
} from "./TelegramCatalogFormatter.js";

import {
  resolveTelegramPricingIdentity,
  searchTelegramCatalog,
} from "./TelegramCatalogService.js";

const first = {
  product: {
    id: 1,
    article: "A2711800109",
    name: "Фільтр <Mercedes>",
  },
  offers: [
    {
      sourceType: "OWN_STOCK",
      quantity: 12,
      displayQuantity: ">5",
      isAvailable: true,
      retailPrice: 900,
      warehouseCity: "Харьков",
    },
    {
      sourceType: "SUPPLIER",
      quantity: 4,
      isAvailable: true,
      retailPrice: 777,
    },
    {
      sourceType: "OWN_STOCK",
      quantity: 0,
      isAvailable: false,
      retailPrice: 100,
    },
  ],
};

const second = {
  product: {
    id: 2,
    article: "HU7185X",
    name: "Фільтр",
  },
  offers: [
    {
      sourceType: "OWN_STOCK",
      quantity: 2,
      displayQuantity: "2",
      isAvailable: true,
      retailPrice: 700,
      warehouseCity: "Харків",
    },
  ],
};

test("MAKA client reply shows only eligible own stock", () => {
  const result = formatTelegramOwnStockVariants({
    query: "A2711800109",
    cards: [first],
    locale: "uk",
  });

  assert.match(result.text, /A2711800109/);
  assert.match(result.text, /900 грн/);
  assert.match(result.text, /Харків/);
  assert.match(result.text, /&gt;5/);
  assert.match(result.text, /&lt;Mercedes&gt;/);
  assert.match(result.text, /<a href=/);

  assert.doesNotMatch(result.text, /777 грн/);
  assert.doesNotMatch(result.text, /100 грн/);
  assert.doesNotMatch(result.text, /12 шт/);
  assert.equal(result.stockEntries.length, 1);
});

test("multi-article responses share the city heading", () => {
  const a = formatTelegramOwnStockVariants({
    query: "A2711800109",
    cards: [first],
    locale: "uk",
  });

  const b = formatTelegramOwnStockVariants({
    query: "HU7185X",
    cards: [second],
    locale: "uk",
  });

  const messages = formatTelegramBatch([a, b], "uk");

  assert.equal(messages.length, 1);
  assert.equal(messages[0].parse_mode, "HTML");

  const text = messages[0].text;

  assert.match(text, /A2711800109/);
  assert.match(text, /HU7185X/);
  assert.match(text, /900 грн/);
  assert.match(text, /700 грн/);

  const headings = text.match(/🏬/g) || [];
  assert.equal(headings.length, 1);
});

test("linked pricing requires an active customer record", async () => {
  const previous = process.env.TELEGRAM_CATALOG_GUEST_ONLY;
  process.env.TELEGRAM_CATALOG_GUEST_ONLY = "false";

  try {
    let sqlSeen = "";

    const identity = await resolveTelegramPricingIdentity(
      {
        chatId: 1001,
        telegramUserId: 1001,
      },
      {
        async query(sql) {
          sqlSeen = sql;
          return {
            rows: [{
              user_id: 42,
              preferred_locale: "uk",
              first_name: "Олександр",
            }],
          };
        },
      },
    );

    assert.equal(identity.userId, 42);
    assert.match(
      sqlSeen,
      /JOIN customers customer ON customer\.user_id = u\.id/,
    );
    assert.match(
      sqlSeen,
      /customer\.is_active = TRUE/,
    );

    const inactive = await resolveTelegramPricingIdentity(
      {
        chatId: 1001,
        telegramUserId: 1001,
      },
      {
        async query() {
          return { rows: [] };
        },
      },
    );

    assert.equal(inactive, null);
  } finally {
    if (previous === undefined) {
      delete process.env.TELEGRAM_CATALOG_GUEST_ONLY;
    } else {
      process.env.TELEGRAM_CATALOG_GUEST_ONLY = previous;
    }
  }
});

test("shared backend price updates are reflected by MAKAtron", async () => {
  const previous = process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED;
  process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED = "true";

  let currentPrice = 950;
  const seen = [];

  try {
    const overrides = {
      getLocale: async () => "uk",
      resolveViewer: async () => ({
        userId: 42,
        locale: "uk",
      }),
      search: async () => {
        throw new Error("Legacy search must remain unused");
      },
      pricing: async () => {
        throw new Error("Bot must not calculate price groups");
      },
      searchWebsite: async (request) => {
        seen.push(request);
        return {
          success: true,
          locale: "uk",
          productCard: {
            product: {
              id: 1,
              article: "A2711800109",
              name: "Фільтр",
            },
            offers: [{
              sourceType: "OWN_STOCK",
              isAvailable: true,
              quantity: 2,
              retailPrice: currentPrice,
              warehouseCity: "Харків",
            }, {
              sourceType: "SUPPLIER",
              isAvailable: true,
              quantity: 5,
              retailPrice: 500,
            }],
          },
        };
      },
    };

    const request = {
      text: "A2711800109",
      chatId: 42,
      telegramUserId: 42,
    };

    const firstReply = await searchTelegramCatalog(
      request, overrides
    );

    assert.match(firstReply[0].text, /950 грн/);
    assert.doesNotMatch(firstReply[0].text, /500 грн/);

    currentPrice = 700;

    const updatedReply = await searchTelegramCatalog(
      request, overrides
    );

    assert.match(updatedReply[0].text, /700 грн/);
    assert.doesNotMatch(updatedReply[0].text, /950 грн/);

    assert.equal(seen.length, 2);
    assert.ok(seen.every(item =>
      item.mode === "client" && item.userId === 42
    ));
  } finally {
    if (previous === undefined) {
      delete process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED;
    } else {
      process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED = previous;
    }
  }
});

test("registration command and staff checkout coexist", async () => {
  const source = await readFile(
    new URL("./TelegramBotService.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /createTelegramRegistrationLink\(/);
  assert.match(source, /Guest-first onboarding/);
  assert.match(
    source,
    /String\(message\.chat\.id\) === String\(message\.from\?\.id\)/,
  );

  const registration = source.indexOf("Guest-first onboarding");
  const startLink = source.indexOf(
    'const match = String(message?.text || "").match'
  );

  assert.ok(registration >= 0);
  assert.ok(startLink > registration);

  assert.match(source, /handleMakatronStaffCallback\(/);
  assert.match(source, /handleTelegramOrderCallback\(/);
  assert.match(source, /link_preview_options/);
});
