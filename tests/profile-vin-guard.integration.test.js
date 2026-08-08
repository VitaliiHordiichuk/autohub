import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { AuthService } from "../src/services/AuthService.js";
import { VinRequestService } from "../src/services/VinRequestService.js";
import { TelegramConnectionService } from "../src/services/TelegramConnectionService.js";

let userId;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

before(async () => {
  await pool.query("UPDATE vin_request_settings SET mode='CHAT',updated_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1");
  const role = await pool.query("SELECT id FROM roles WHERE name='CLIENT' LIMIT 1");
  const result = await pool.query(
    `INSERT INTO users(first_name,last_name,phone,email,password_hash,role_id,is_active)
     VALUES('Test','Client','+380501112233',$1,'test-hash',$2,TRUE) RETURNING id`,
    [`profile-vin-${suffix}@autohub.local`, role.rows[0].id]
  );
  userId = Number(result.rows[0].id);
});

after(async () => {
  await pool.query("UPDATE vin_request_settings SET mode='CHAT',updated_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1");
  if (userId) {
    await pool.query(
      "DELETE FROM vin_request_recommendations WHERE vin_request_id IN(SELECT id FROM vin_requests WHERE user_id=$1)",
      [userId]
    );
    await pool.query("DELETE FROM vin_requests WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  await pool.end();
});

test("клиент может изменить данные профиля, а новый телефон сбрасывает подтверждение", async () => {
  await pool.query(
    "UPDATE users SET phone_verified_at=CURRENT_TIMESTAMP,phone_verified_value=phone WHERE id=$1",
    [userId]
  );

  const result = await AuthService.updateProfile(userId, {
    firstName: "Updated",
    lastName: "Customer",
    phone: "067 123 45 67",
    email: `updated-${suffix}@autohub.local`,
  });

  assert.equal(result.user.firstName, "Updated");
  assert.equal(result.user.lastName, "Customer");
  assert.equal(result.user.phone, "+380671234567");
  assert.equal(result.phoneVerificationReset, true);

  const stored = await pool.query(
    "SELECT phone_verified_at,phone_verified_value FROM users WHERE id=$1",
    [userId]
  );
  assert.equal(stored.rows[0].phone_verified_at, null);
  assert.equal(stored.rows[0].phone_verified_value, null);
});

test("первый VIN-запрос доступен без проверки, повторный за 24 часа требует её", async () => {
  const firstStatus = await VinRequestService.phoneVerificationStatus(userId);
  assert.equal(firstStatus.verified, false);
  assert.equal(firstStatus.required, false);
  assert.equal(firstStatus.canCreate, true);

  await pool.query(
    `INSERT INTO vin_requests(user_id,vin,request_text,contact_phone)
     VALUES($1,'WDD2120471A387679','Test request',$2)`,
    [userId, "+380671234567"]
  );

  const repeatedStatus = await VinRequestService.phoneVerificationStatus(userId);
  assert.equal(repeatedStatus.required, true);
  assert.equal(repeatedStatus.canCreate, false);

  await pool.query(
    "UPDATE users SET phone_verified_at=CURRENT_TIMESTAMP,phone_verified_value=phone WHERE id=$1",
    [userId]
  );

  const verifiedStatus = await VinRequestService.phoneVerificationStatus(userId);
  assert.equal(verifiedStatus.verified, true);
  assert.equal(verifiedStatus.required, false);
  assert.equal(verifiedStatus.canCreate, true);
});

test("Telegram подтверждает только собственный номер клиента", async () => {
  const telegramId = Number(String(Date.now()).slice(-9));
  await pool.query(`
    INSERT INTO user_telegram_connections(
      user_id, telegram_chat_id, telegram_user_id, preferred_locale
    ) VALUES($1, $2, $2, 'ru')
  `, [userId, telegramId]);

  const mismatch = await TelegramConnectionService.verifyPhoneFromTelegram({
    chatId: telegramId,
    telegramUserId: telegramId,
    phoneNumber: "+380501234567",
  });
  assert.equal(mismatch.verified, false);
  assert.equal(mismatch.reason, "PHONE_MISMATCH");

  const verified = await TelegramConnectionService.verifyPhoneFromTelegram({
    chatId: telegramId,
    telegramUserId: telegramId,
    phoneNumber: "+380671234567",
  });
  assert.equal(verified.verified, true);
  assert.deepEqual(verified.userIds, [userId]);

  const stored = await pool.query(
    "SELECT phone_verified_at, phone_verified_value FROM users WHERE id=$1",
    [userId]
  );
  assert.ok(stored.rows[0].phone_verified_at);
  assert.equal(stored.rows[0].phone_verified_value, "+380671234567");
});

test("блокировка закрывает VIN-чаты клиента и не даёт писать до разблокировки", async () => {
  const requests = await VinRequestService.listForUser(userId);
  assert.ok(requests.length > 0);
  const requestId = Number(requests[0].id);

  await VinRequestService.setClientBlock({
    userId,
    blocked: true,
    changedBy: userId,
    reason: "Integration test",
  });

  const blockedStatus = await VinRequestService.phoneVerificationStatus(userId);
  assert.equal(blockedStatus.blocked, true);
  assert.equal(blockedStatus.canCreate, false);

  const closed = await VinRequestService.getForUser(requestId, userId);
  assert.equal(closed.status, "CLOSED");

  await assert.rejects(
    VinRequestService.addClientMessage({ requestId, userId, message: "Test reply" }),
    (error) => error?.code === "VIN_CLIENT_BLOCKED"
  );

  await VinRequestService.setClientBlock({
    userId,
    blocked: false,
    changedBy: userId,
  });

  const unblockedStatus = await VinRequestService.phoneVerificationStatus(userId);
  assert.equal(unblockedStatus.blocked, false);
  assert.equal(unblockedStatus.canCreate, true);
});

test("клиент закрывает предложенную деталь, но ссылка и запись сохраняются", async () => {
  const requests = await VinRequestService.listForUser(userId);
  const requestId = Number(requests[0].id);
  const offer = await pool.query(
    `SELECT po.id,po.product_id FROM product_offers po
     ORDER BY po.id LIMIT 1`
  );
  assert.ok(offer.rows[0]);
  const recommendation = await pool.query(
    `INSERT INTO vin_request_recommendations(vin_request_id,product_id,product_offer_id,added_by)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [requestId, offer.rows[0].product_id, offer.rows[0].id, userId]
  );

  const updated = await VinRequestService.dismissRecommendation({
    requestId,
    recommendationId: Number(recommendation.rows[0].id),
    userId,
  });

  const dismissed = updated.recommendations.find(
    (item) => item.id === Number(recommendation.rows[0].id)
  );
  assert.ok(dismissed?.dismissedAt);
  const stored = await pool.query(
    "SELECT dismissed_at FROM vin_request_recommendations WHERE id=$1",
    [recommendation.rows[0].id]
  );
  assert.ok(stored.rows[0]?.dismissed_at);
});

test("режим одного запроса в сутки отключает переписку и повторное создание", async () => {
  const requests = await VinRequestService.listForUser(userId);
  const requestId = Number(requests[0].id);

  await VinRequestService.updateSettings({
    mode: "DAILY_REQUEST",
    changedBy: userId,
  });

  const status = await VinRequestService.phoneVerificationStatus(userId);
  assert.equal(status.mode, "DAILY_REQUEST");
  assert.equal(status.chatEnabled, false);
  assert.equal(status.dailyLimitReached, true);
  assert.equal(status.canCreate, false);

  await assert.rejects(
    VinRequestService.addClientMessage({ requestId, userId, message: "Another reply" }),
    (error) => error?.code === "VIN_CHAT_DISABLED"
  );
});

test("режим полного отключения запрещает новые VIN-запросы", async () => {
  await VinRequestService.updateSettings({
    mode: "DISABLED",
    changedBy: userId,
  });

  const status = await VinRequestService.phoneVerificationStatus(userId);
  assert.equal(status.mode, "DISABLED");
  assert.equal(status.requestEnabled, false);
  assert.equal(status.chatEnabled, false);
  assert.equal(status.canCreate, false);
});
