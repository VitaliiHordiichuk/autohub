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
      getLocale: async () => "uk",
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
    return { rows: [{ user_id: 42, preferred_locale: "uk", first_name: "Олександр" }] };
  } };
  const result = await resolveTelegramPricingIdentity(
    { chatId: 1001, telegramUserId: 2002 }, db,
  );
  assert.deepEqual(result, { userId: 42, locale: "uk", firstName: "Олександр" });
  assert.deepEqual(queries[0].args, [1001, 2002]);
  assert.match(queries[0].sql, /u\.first_name/);
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
  assert.match(responses[0].text, /не знайдено/);
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
    assert.match(results[0].text, /Не вдалося перевірити/);
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


test("по /start MAKAtron приветствует клиента по имени из его профиля", async () => {
  const { services, calls } = mockServices({ viewer: {
    userId: 42, firstName: "Олександр", locale: "uk",
  } });
  const [reply] = await searchTelegramCatalog({
    text: "/start", chatId: 1001, telegramUserId: 2002,
  }, services);
  assert.match(reply.text, /Привіт, Олександр!/);
  assert.match(reply.text, /MAKAtron/);
  assert.equal(reply.parse_mode, "HTML");
  assert.equal(calls.searched.length, 0);
  const [help] = await searchTelegramCatalog({ text: "/help", chatId: 1001, telegramUserId: 2002 }, services);
  assert.doesNotMatch(help.text, /Олександр/);
  const [searchReply] = await searchTelegramCatalog({ text: "A2711800109", chatId: 1001, telegramUserId: 2002 }, services);
  assert.doesNotMatch(searchReply.text, /Олександр/);
});

test("по /start незарегистрированного гостя приветствует без имени", async () => {
  const { services } = mockServices();
  const [reply] = await searchTelegramCatalog({
    text: "/start", chatId: 1001, telegramUserId: 2002,
  }, services);
  assert.match(reply.text, /Привіт! Я MAKAtron/);
  assert.doesNotMatch(reply.text, /Олександр/);
});


test("изолированный MAKAtron не использует привязки и персональные цены прежнего бота", async () => {
  const before = process.env.TELEGRAM_CATALOG_GUEST_ONLY;
  process.env.TELEGRAM_CATALOG_GUEST_ONLY = "true";
  try {
    const identity = await resolveTelegramPricingIdentity({ chatId: 1, telegramUserId: 1 }, {
      query: async () => { throw Error("must not read legacy Telegram connections"); },
    });
    assert.equal(identity, null);
  } finally {
    if (before === undefined) delete process.env.TELEGRAM_CATALOG_GUEST_ONLY;
    else process.env.TELEGRAM_CATALOG_GUEST_ONLY = before;
  }
});

test("англомовні запити повертають лише англомовні шаблони", async () => {
  const { services } = mockServices();
  services.getLocale = async () => "en";
  const responses = await searchTelegramCatalog({
    text:"A2711800109\nZZZ99999", chatId: 1, telegramUserId: 2,
  }, services);
  assert.match(responses[0].text, /Results/);
  assert.match(responses[0].text, /not found/);
  assert.match(responses[0].text, /MAKA warehouse/);
  assert.doesNotMatch(responses[0].text, /не знайдено|Результати/);
});

test("shared mode uses the live website backend for CLIENT and never runs Telegram-side search rules",async()=>{
 const previous=process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED;
 process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED="true";
 const calls=[];
 try{
  const responses=await searchTelegramCatalog({
   text:"A2966808206",chatId:42,telegramUserId:42
  },{
   getLocale:async()=> "uk",
   resolveViewer:async()=>({userId:42,locale:"uk",firstName:"Тест"}),
   search:async()=>{throw Error("Legacy Telegram search must never run");},
   pricing:async()=>{throw Error("Worker pricing must not run");},
   buildCard:async()=>{throw Error("Worker card builder must not run");},
   searchWebsite:async req=>{
    calls.push(req);
    return {success:true,locale:"uk",
      productCard:{product:{id:11,article:"A2966808206",name:"Килимки"},
       offers:[{id:9,sourceType:"OWN_STOCK",isAvailable:true,
        quantity:1,displayQuantity:"1",retailPrice:200}]},
      family:[{product:{id:12,article:"A29668082069051",name:"Килимки"},
       offers:[{id:10,sourceType:"OWN_STOCK",isAvailable:true,
        quantity:1,retailPrice:210}]}]
    };
   }
  });
  assert.deepEqual(calls,[{
   article:"A2966808206",locale:"uk",mode:"client",userId:42
  }]);
  assert.equal(responses.length,1);
  assert.match(responses[0].text,/A2966808206/);
  assert.match(responses[0].text,/A29668082069051/);
  assert.match(responses[0].text,/200 грн/);
 }finally{
  if(previous===undefined)delete process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED;
  else process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED=previous;
 }
});


test("shared website lookup returns every actually stocked variant for two requested articles, not supplier-only HU718/5X", async () => {
  const previous = process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED;
  process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED = "true";
  const calls = [];
  try {
    const replies = await searchTelegramCatalog({
      text: "2711800109\nA1673200503", chatId: 0, telegramUserId: 0,
    }, {
      getLocale: async () => "uk",
      resolveViewer: async () => null,
      search: async () => { throw Error("Must search shared site, not legacy"); },
      searchWebsite: async req => {
        calls.push(req);
        if (req.article === "2711800109") {
          return { success: true, locale: "uk",
            productCard: { product: { id: 101, article: "A2711800109", name: "Масляний фільтр" },
              offers: [{ id: 1, sourceType: "OWN_STOCK", warehouseCity: "Харків",
                isAvailable: true, quantity: 4, retailPrice: 1380.96 }] },
            family: [
              { product: { id: 102, article: "A271180010990", name: "Фільтр масляний" },
                offers: [{ id: 2, sourceType: "OWN_STOCK", warehouseCity: "Харків",
                  isAvailable: true, quantity: 2, retailPrice: 1500 }] },
              { product: { id: 103, article: "HU718/5X", name: "Фільтр, тільки постачальник" },
                offers: [{ id: 3, sourceType: "SUPPLIER",
                  isAvailable: true, quantity: 10, retailPrice: 700 }] },
            ] };
        }
        return { success: true, locale: "uk",
          productCard: { product: { id: 201, article: "A1673200503", name: "Стійка амортизаційна підвіски" },
            offers: [{ id: 4, sourceType: "OWN_STOCK", warehouseCity: "Харків",
              isAvailable: true, quantity: 1, retailPrice: 189741.3 }] },
          replacement: { targetArticle: "A167320050380" },
          family: [{ product: { id: 202, article: "A167320050380", name: "Заміна стійки" },
            offers: [{ id: 5, sourceType: "OWN_STOCK", warehouseCity: "Харків",
              isAvailable: false, quantity: 0, retailPrice: 1000 }] }],
        };
      },
    });
    assert.deepEqual(calls, [
      { article: "2711800109", locale: "uk", mode: "guest", userId: null },
      { article: "A1673200503", locale: "uk", mode: "guest", userId: null },
    ]);
    assert.equal(replies.length, 1);
    const msg = replies[0].text;
    assert.match(msg, /MAKAtron · Результати 1–2 з 2/);
    assert.match(msg, /🏬 <b>Склад Харків<\/b>/);
    assert.match(msg, /href="https:\/\/maka\.com\.ua\/uk\/product\/A2711800109"/);
    assert.match(msg, /href="https:\/\/maka\.com\.ua\/uk\/product\/A271180010990"/);
    assert.match(msg, /href="https:\/\/maka\.com\.ua\/uk\/product\/A1673200503"/);
    assert.match(msg, /🟢 <b>В наявності: 4 шт\.<\/b>/);
    assert.match(msg, /🟢 <b>В наявності: 2 шт\.<\/b>/);
    assert.match(msg, /189[\s\u00a0]741,3 грн/);
    assert.doesNotMatch(msg, /HU718\/5X|A167320050380|Фільтр, тільки постачальник|Інші номери|Надішліть \/register|Склад MAKA/);
    assert.equal((msg.match(/🔎/g) || []).length, 3);
    assert.equal(replies[0].parse_mode, "HTML");
  } finally {
    if (previous === undefined) delete process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED;
    else process.env.MAKATRON_SHARED_SITE_SEARCH_ENABLED = previous;
  }
});
