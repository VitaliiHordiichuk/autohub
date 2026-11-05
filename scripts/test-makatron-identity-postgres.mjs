// Real PostgreSQL integration smoke test for the MAKAtron identity patch.
// Runs against the *empty, isolated* staging DB only. Never starts the web
// server or Telegram polling and never makes an external network request.
import assert from "node:assert/strict";
import { config as loadDotenv } from "dotenv";

const database = "maka_identity_stage_20261105";
if (process.env.MAKA_IDENTITY_STAGE_DB !== database) {
  throw new Error("Set MAKA_IDENTITY_STAGE_DB to the exact isolated staging DB");
}
if (!process.env.MAKA_IDENTITY_CONFIG_FILE) {
  throw new Error("Missing MAKA_IDENTITY_CONFIG_FILE");
}
loadDotenv({ path: process.env.MAKA_IDENTITY_CONFIG_FILE, quiet: true });

// The application credentials are reused, but NEVER its database or JWT secret.
process.env.DB_NAME = database;
process.env.AUTH_JWT_SECRET = "maka-identity-staging-only-do-not-reuse-20261105";
process.env.TELEGRAM_CATALOG_GUEST_ONLY = "false";
process.env.TELEGRAM_BOT_LINKING_ENABLED = "true";
process.env.TELEGRAM_BOT_TOKEN = "synthetic-not-a-real-bot-token";
process.env.TELEGRAM_BOT_USERNAME = "MAKA_com_ua_bot";

const { pool } = await import("../src/config/db.js");
const { AuthService } = await import("../src/services/AuthService.js");
const { CustomerPricingService } = await import("../src/services/CustomerPricingService.js");
const { CustomerManagementService } = await import("../src/services/CustomerManagementService.js");
const { TelegramConnectionService } = await import("../src/services/TelegramConnectionService.js");
const { resolveTelegramPricingIdentity } = await import("../src/services/TelegramCatalogService.js");
const { createTelegramRegistrationLink, claimTelegramRegistrationLink } =
  await import("../src/services/TelegramIdentityLinkService.js");

const testSender = 9000000001;
const item = { retailPrice: 1000, minimumSalePrice: 700 };
let seeded = false;
let passed = false;

async function count(sql) {
  return Number((await pool.query(sql)).rows[0].n);
}
async function priceForCurrentSender() {
  const viewer = await resolveTelegramPricingIdentity({
    chatId: testSender, telegramUserId: testSender,
  });
  const pricing = await CustomerPricingService.getContext(viewer?.userId ?? null);
  return { viewer, price: CustomerPricingService.price(item, pricing)?.customerPrice };
}

try {
  assert.equal(process.env.DB_NAME, database);
  assert.equal(await count("SELECT COUNT(*) AS n FROM users"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM customers"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM user_telegram_connections"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM roles"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM price_groups"), 0);

  const role = (await pool.query(
    "INSERT INTO roles(name) VALUES ('CLIENT') RETURNING id",
  )).rows[0].id;
  const adminRole = (await pool.query(
    "INSERT INTO roles(name) VALUES ('ADMIN') RETURNING id",
  )).rows[0].id;
  await pool.query(
    "INSERT INTO price_groups(name,discount_percent,pricing_mode) VALUES " +
    "('Registered',5,'DISCOUNT'),('GOLD',25,'DISCOUNT'),('VIP',0,'MINIMUM')",
  );
  const admin = (await pool.query(
    "INSERT INTO users(first_name,email,password_hash,role_id,is_active) " +
      "VALUES('Staging Administrator','staging-admin@example.invalid','!disabled!',$1,true) RETURNING id",
    [adminRole],
  )).rows[0];
  seeded = true;

  let result = await priceForCurrentSender();
  assert.equal(result.viewer, null);
  assert.equal(result.price, 1000);
  console.log("GUEST: 1000 UAH PASS");

  const link = await createTelegramRegistrationLink({
    chatId: testSender, telegramUserId: testSender, locale: "uk",
  });
  assert.match(link.url, /^https:\/\/maka\.com\.ua\/uk\/register#tg=[a-f0-9]{48}$/);
  const proof = new URLSearchParams(new URL(link.url).hash.slice(1)).get("tg");
  assert.ok(proof);

  const account = await AuthService.register({
    firstName: "Staging Client",
    lastName: "Test",
    phone: "+380671234567",
    email: "maka-identity-stage@example.invalid",
    password: "StagingTestOnlyPass123!",
    telegramRegistrationToken: proof,
  });
  const userId = Number(account.user.id);
  result = await priceForCurrentSender();
  assert.equal(result.viewer?.userId, userId);
  assert.equal(result.price, 950);
  console.log("BOT -> WEBSITE REGISTRATION -> REGISTERED: 950 UAH PASS");

  await assert.rejects(
    claimTelegramRegistrationLink({ token: proof, userId }, pool),
    error => error.apiCode === "TELEGRAM_LINK_EXPIRED",
  );
  console.log("ONE-TIME LINK REPLAY REJECTED PASS");

  const customer = (await pool.query(
    "SELECT id FROM customers WHERE user_id=$1", [userId],
  )).rows[0];
  for (const [name,expected] of [["GOLD",750],["VIP",700],["Registered",950]]) {
    const groupId = (await pool.query(
      "SELECT id FROM price_groups WHERE name=$1", [name],
    )).rows[0].id;
    await CustomerManagementService.setPriceGroup({
      customerId: Number(customer.id), priceGroupId: Number(groupId),
      changedBy: Number(admin.id),
    });
    result = await priceForCurrentSender();
    assert.equal(result.viewer?.userId, userId);
    assert.equal(result.price, expected);
    console.log("ADMIN GROUP -> " + name + ": " + expected + " UAH PASS");
  }

  // Registration on the website without a Telegram proof never guesses a
  // sender ID by phone/email/name. Explicit linking is required in this case.
  const another = await AuthService.register({
    firstName: "Second Staging Client",
    phone: "+380671234568",
    email: "maka-identity-stage-second@example.invalid",
    password: "StagingTestOnlyPass123!",
  });
  assert.equal((await priceForCurrentSender()).viewer.userId, userId);

  // The existing authenticated-website -> Telegram route must safely move
  // this sender's CLIENT identity to the newly confirmed account.
  const confirmation = await TelegramConnectionService.createLink(
    another.user.id, "uk",
  );
  const secondProof = new URL(confirmation.url).searchParams.get("start");
  const connected = await TelegramConnectionService.connectFromTelegram({
    token: secondProof,
    chatId: testSender,
    telegramUserId: testSender,
    username: "staging_client",
    firstName: "Staging",
  });
  assert.equal(Number(connected.userId), Number(another.user.id));
  assert.equal((await priceForCurrentSender()).viewer.userId, Number(another.user.id));
  const old = await TelegramConnectionService.status(userId);
  assert.equal(old.connected, false);
  const newLinkCount = await count(
    "SELECT COUNT(*) AS n FROM user_telegram_connections " +
    "WHERE telegram_chat_id=9000000001 AND telegram_user_id=9000000001",
  );
  assert.equal(newLinkCount, 1);
  console.log("EXPLICIT RE-LINK REPLACES OLD CLIENT ID PASS");

  passed = true;
  console.log("REAL BACKEND + DATABASE IDENTITY SCENARIO: PASS");
} finally {
  // Stage-only cleanup. No data in autohub are ever read or written.
  if (seeded) {
    try {
      await pool.query(
        "TRUNCATE roles, users, price_groups, telegram_registration_claims " +
        "RESTART IDENTITY CASCADE",
      );
      if (passed) {
        assert.equal(await count("SELECT COUNT(*) AS n FROM users"), 0);
        assert.equal(await count("SELECT COUNT(*) AS n FROM customers"), 0);
        assert.equal(await count("SELECT COUNT(*) AS n FROM user_telegram_connections"), 0);
        console.log("STAGING DATA CLEANED: 0 USERS, 0 CUSTOMERS, 0 LINKS");
      }
    } catch (error) {
      console.error("STAGING CLEANUP FAILED (test database only):", error.message);
      process.exitCode = 1;
    }
  }
  await pool.end();
}
