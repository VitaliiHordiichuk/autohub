import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TelegramConnectionService } from "./TelegramConnectionService.js";
import { createTelegramLink } from "../controllers/telegram-connection.controller.js";

async function configured(username, token, run) {
  const previous = { username: process.env.TELEGRAM_BOT_USERNAME, token: process.env.TELEGRAM_BOT_TOKEN };
  if (username === undefined) delete process.env.TELEGRAM_BOT_USERNAME;
  else process.env.TELEGRAM_BOT_USERNAME = username;
  if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = token;
  try { await run(); }
  finally {
    if (previous.username === undefined) delete process.env.TELEGRAM_BOT_USERNAME;
    else process.env.TELEGRAM_BOT_USERNAME = previous.username;
    if (previous.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous.token;
  }
}

function memoryDb() {
  const calls = [];
  return { calls, query: async (sql, args) => { calls.push({ sql, args }); return { rows: [] }; } };
}

test("isolated HTTP API issues a linking proof without holding the Telegram bot secret", async () => {
  await configured("MAKA_com_ua_bot", undefined, async () => {
    const db = memoryDb();
    const link = await TelegramConnectionService.createLink(42, "uk", db);
    assert.match(link.url, /^https:\/\/t\.me\/MAKA_com_ua_bot\?start=[a-f0-9]{48}$/);
    assert.equal(link.expiresInMinutes, 15);
    const proof = new URL(link.url).searchParams.get("start");
    const insert = db.calls.find(call => call.sql.includes("INSERT INTO telegram_link_tokens"));
    assert.deepEqual(insert.args, [42, createHash("sha256").update(proof).digest("hex"), "uk"]);
    assert.match(insert.sql, /INTERVAL '15 minutes'/);
    assert.ok(!db.calls.some(call => call.args.includes(proof)), "only the proof hash is persisted");
  });
});

test("the actual account controller returns the root URL/expiry envelope expected by the frontend", async () => {
  await configured("MAKA_com_ua_bot", undefined, async () => {
    const db = memoryDb();
    const original = TelegramConnectionService.createLink;
    TelegramConnectionService.createLink = (id, locale) => original(id, locale, db);
    try {
      let body;
      const res = { json: value => { body = value; return value; }, status: () => { throw new Error("unexpected HTTP failure"); } };
      await createTelegramLink({ auth: { userId: 42 }, body: { locale: "en" } }, res);
      assert.equal(body.success, true);
      assert.match(body.url, /^https:\/\/t\.me\/MAKA_com_ua_bot\?start=[a-f0-9]{48}$/);
      assert.equal(body.expiresInMinutes, 15);
      assert.equal(db.calls.at(-1).args[0], 42);
      assert.equal(db.calls.at(-1).args[2], "en");
    } finally { TelegramConnectionService.createLink = original; }
  });
});

test("a missing public bot username still fails before any database operation", async () => {
  for (const username of [undefined, "", "   "]) {
    await configured(username, "unused-test-secret", async () => {
      const db = memoryDb();
      await assert.rejects(TelegramConnectionService.createLink(42, "uk", db), error => error.code === "TELEGRAM_NOT_CONFIGURED");
      assert.equal(db.calls.length, 0);
    });
  }
});

test("a configured username retains its existing @ normalization without a bot token", async () => {
  await configured("@MAKA_com_ua_bot ", undefined, async () => {
    const result = await TelegramConnectionService.createLink(42, "uk", memoryDb());
    assert.match(result.url, /^https:\/\/t\.me\/MAKA_com_ua_bot\?start=/);
  });
});

test("reissued links remain random and invalidate earlier proofs through the same scoped cleanup", async () => {
  await configured("MAKA_com_ua_bot", undefined, async () => {
    const db = memoryDb();
    const first = await TelegramConnectionService.createLink(42, "uk", db);
    const second = await TelegramConnectionService.createLink(42, "uk", db);
    assert.notEqual(first.url, second.url);
    const cleanup = db.calls.filter(call => call.sql.includes("DELETE FROM telegram_link_tokens"));
    assert.equal(cleanup.length, 2);
    for (const call of cleanup) {
      assert.match(call.sql, /user_id = \$1 OR expires_at < CURRENT_TIMESTAMP/);
      assert.deepEqual(call.args, [42]);
    }
  });
});

test("mismatched Telegram sender/chat still cannot consume a linking proof", async () => {
  assert.equal(await TelegramConnectionService.connectFromTelegram({ token: "a".repeat(48), chatId: -100, telegramUserId: 100 }), null);
});
