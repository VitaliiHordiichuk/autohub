import test from "node:test";
import assert from "node:assert/strict";
import {
  createTelegramRegistrationLink,
  claimTelegramRegistrationLink,
  bindVerifiedTelegramClient,
} from "./TelegramIdentityLinkService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";

test("guest receives retail; registered client and changed group use live site pricing", async () => {
  let group = { name: "Registered", discount_percent: "5.00", pricing_mode: "DISCOUNT" };
  const db = { query: async (sql, args) => {
    assert.match(sql, /FROM users u/);
    assert.deepEqual(args, [42]);
    return { rows: [{
      role_name: "CLIENT", active_staff: false,
      customer_id: 37, ...group,
    }] };
  } };
  const item = { retailPrice: 1000, minimumSalePrice: 700 };
  const guest = await CustomerPricingService.getContext(null, db);
  assert.equal(CustomerPricingService.price(item, guest).customerPrice, 1000);
  const registered = await CustomerPricingService.getContext(42, db);
  assert.equal(CustomerPricingService.price(item, registered).customerPrice, 950);
  group = { name: "GOLD", discount_percent: "25.00", pricing_mode: "DISCOUNT" };
  const gold = await CustomerPricingService.getContext(42, db);
  assert.equal(CustomerPricingService.price(item, gold).customerPrice, 750);
  group = { name: "VIP", discount_percent: "0.00", pricing_mode: "MINIMUM" };
  const vip = await CustomerPricingService.getContext(42, db);
  assert.equal(CustomerPricingService.price(item, vip).customerPrice, 700);
});

test("a private bot registration link is single-use proof, not a self-reported ID", async () => {
  const inserts = [];
  const db = { query: async (sql, args) => {
    inserts.push({ sql, args });
    if (sql.includes("SELECT c.user_id FROM user_telegram_connections"))
      return { rows: [] };
    if (sql.includes("FROM telegram_registration_claims"))
      return { rows: [{
        telegram_chat_id: 1001, telegram_user_id: 1001,
        telegram_username: "test", telegram_first_name: "Client",
        preferred_locale: "uk",
      }] };
    return { rows: [] };
  } };
  const link = await createTelegramRegistrationLink({
    chatId: 1001, telegramUserId: 1001, locale: "uk",
  }, db);
  assert.equal(link.alreadyLinked, false);
  assert.match(link.url, /^https:\/\/maka.com.ua\/uk\/register\?tg=[a-f0-9]{48}$/);
  const token = new URL(link.url).searchParams.get("tg");
  assert.equal(inserts[1].args[5].length, 64, "Only a SHA256 hash is persisted");
  assert.ok(!inserts.some(row => row.args?.includes(token)));
  await claimTelegramRegistrationLink({ token, userId: 42 }, db);
  const transferred = inserts.find(row => row.sql.startsWith("DELETE FROM user_telegram_connections"));
  assert.match(transferred.sql, /r.name='CLIENT'/, "Do not remove shared staff links");
  assert.deepEqual(transferred.args, [42, 1001, 1001]);
  const inserted = inserts.find(row => row.sql.startsWith("INSERT INTO user_telegram_connections"));
  assert.deepEqual(inserted.args.slice(0, 3), [42, 1001, 1001]);
  assert.ok(inserts.some(row => row.sql.includes("SET used_at=CURRENT_TIMESTAMP")));
});

test("Telegram registration requires matching verified private chat and sender", async () => {
  const db = { query: async () => { throw new Error("No database access"); } };
  await assert.rejects(createTelegramRegistrationLink({
    chatId: -123, telegramUserId: 123,
  }, db), /verified private/);
  await assert.rejects(createTelegramRegistrationLink({
    chatId: 123, telegramUserId: 456,
  }, db), /verified private/);
  await assert.rejects(bindVerifiedTelegramClient({
    userId: 42, chatId: 123, telegramUserId: 456,
  }, db), /verified private/);
});

test("an expired/invalid Telegram proof never creates an account link", async () => {
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    claimTelegramRegistrationLink({ token: "not-a-token", userId: 42 }, db),
    error => error.apiCode === "TELEGRAM_LINK_INVALID",
  );
  await assert.rejects(
    claimTelegramRegistrationLink({ token: "a".repeat(48), userId: 42 }, db),
    error => error.apiCode === "TELEGRAM_LINK_EXPIRED",
  );
});

test("already-linked Telegram account does not issue a second registration token", async () => {
  const db = { query: async sql => {
    if (sql.includes("SELECT c.user_id FROM user_telegram_connections"))
      return { rows: [{ user_id: 42 }] };
    throw new Error("Must not issue a token");
  } };
  const result = await createTelegramRegistrationLink({
    chatId: 1001, telegramUserId: 1001,
  }, db);
  assert.deepEqual(result, { alreadyLinked: true, url: null });
});
