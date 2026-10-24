import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveTelegramPricingIdentity, searchTelegramCatalog,
} from "./TelegramCatalogService.js";

const product = { id: 10, article: "A2711800109", name: "Фильтр масла" };

function mockServices({ viewer = null, failArticle = null } = {}) {
  const calls = { pricingIds: [], cardContexts: [], searched: [] };
  return {
    calls,
    services: {
      resolveViewer: async () => viewer,
      pricing: async (userId) => {
        calls.pricingIds.push(userId);
        return { discountPercent: userId ? 5 : 0 };
      },
      search: async (article) => {
        calls.searched.push(article);
        if (article === failArticle) throw Error("Simulated backend error");
        if (article === "ZZZ99999") return { found: false };
        return { found: true, exactProduct: { ...product, article },
          replacementPath: [{ linkType: "REPLACEMENT", targetArticle: "A2711800209" }] };
      },
      buildCard: async (item, context, availability) => {
        calls.cardContexts.push({ context, availability });
        return { product: item, offers: [{
          sourceType: "OWN_STOCK", isAvailable: true, quantity: 2,
          retailPrice: context.discountPercent ? 95 : 100,
        }], analogs: [], replacements: [] };
      },
      present: async ({ productCard, requestedLocale, includeSourceDetails }) => {
        assert.equal(includeSourceDetails, false);
        return { productCard, locale: requestedLocale };
      },
    },
  };
}

test("личную скидку получает только уникальная действующая связка chat_id + telegram_user_id", async () => {
  const queries = [];
  const db = { query: async (sql, args) => {
    queries.push({ sql, args });
    return { rows: [{ user_id: 42, preferred_locale: "uk" }] };
  } };
  const result = await resolveTelegramPricingIdentity(
    { chatId: 1001, telegramUserId: 2002 }, db,
  );
  assert.deepEqual(result, { userId: 42, locale: "uk" });
  assert.deepEqual(queries[0].args, [1001, 2002]);
  assert.match(queries[0].sql, /u\.is_active = TRUE/);
  assert.match(queries[0].sql, /r\.name = 'CLIENT'/);
  assert.match(queries[0].sql, /c\.telegram_user_id = \$2/);
});

test("без связи или с неоднозначной связью персональные цены недоступны", async () => {
  const input = { chatId: 1, telegramUserId: 2 };
  assert.equal(await resolveTelegramPricingIdentity(input, {
    query: async () => ({ rows: [] }),
  }), null);
  assert.equal(await resolveTelegramPricingIdentity(input, {
    query: async () => ({ rows: [{ user_id: 1 }, { user_id: 2 }] }),
  }), null);
  assert.equal(await resolveTelegramPricingIdentity({ chatId: 1, telegramUserId: null }, {
    query: async () => { throw Error("should not query"); },
  }), null);
});

test("гость получает розницу и наличие, не персональную скидку", async () => {
  const { calls, services } = mockServices();
  const response = await searchTelegramCatalog({
    text: "A2711800109", chatId: 1001, telegramUserId: 2002,
  }, services);
  assert.deepEqual(calls.pricingIds, [null]);
  assert.equal(calls.cardContexts[0].availability.userId, null);
  assert.match(response[0].text, /100 грн/);
  assert.match(response[0].text, /Склад MAKA/);
  assert.match(response[0].text, /A2711800209/);
  assert.match(response[0].reply_markup.inline_keyboard[0][0].url, /^https:/);
});

test("связанный CLIENT получает собственный контекст скидки и доступности", async () => {
  const { calls, services } = mockServices({ viewer: { userId: 42, locale: "uk" } });
  const response = await searchTelegramCatalog({
    text: "A2711800109", chatId: 1001, telegramUserId: 2002,
  }, services);
  assert.deepEqual(calls.pricingIds, [42]);
  assert.deepEqual(calls.cardContexts[0].availability, { userId: 42, cartId: null });
  assert.match(response[0].text, /95 грн/);
  assert.doesNotMatch(response[0].text, /100 грн/);
});

test("массовый поиск возвращает последовательные итоги, включая отсутствующие", async () => {
  const { calls, services } = mockServices();
  const responses = await searchTelegramCatalog({
    text: "A2711800109\nZZZ99999\nHU7185X", chatId: 1, telegramUserId: 2,
  }, services);
  assert.deepEqual(calls.searched, ["A2711800109", "ZZZ99999", "HU7185X"]);
  assert.equal(responses.length, 1);
  assert.match(responses[0].text, /не найдено/);
  assert.match(responses[0].text, /HU7185X/);
});

test("сбой одной позиции не прерывает обработку остальных", async () => {
  const { services } = mockServices({ failArticle: "HU7185X" });
  const original = console.error;
  console.error = () => {};
  try {
    const results = await searchTelegramCatalog({
      text: "A2711800109\nHU7185X\nA2711800109", chatId: 1, telegramUserId: 2,
    }, services);
    assert.match(results[0].text, /Не удалось проверить/);
    assert.match(results[0].text, /A2711800109/);
  } finally { console.error = original; }
});

test("команды /start и /help не запускают поиск по товару", async () => {
  const { calls, services } = mockServices();
  assert.match((await searchTelegramCatalog({ text: "/start" }, services))[0].text, /MAKA/);
  assert.match((await searchTelegramCatalog({ text: "/help" }, services))[0].text, /MAKA/);
  assert.deepEqual(await searchTelegramCatalog({ text: "/unknown" }, services), []);
  assert.equal(calls.searched.length, 0);
});
