import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { pool } from "../config/db.js";
import { connectMakatronStaff, issueMakatronStaffLink, resolveMakatronStaff,
  sendPendingStaffOrderNotifications } from "./MakatronStaffService.js";

const isolated = String(process.env.DB_HOST || "").startsWith("/private/tmp/") &&
  /_test$/.test(String(process.env.DB_NAME || "")) &&
  process.env.ISOLATED_TEST_DB_CONFIRMATION === "LOCAL_TEST_CLUSTER_ONLY";
test.after(async () => { await pool.end(); });

test("staff Telegram commands and notifications obey independent permissions", {
  skip: !isolated ? "requires confirmed isolated local PostgreSQL" : false,
}, async () => {
  const dataDirectory = (await pool.query("SELECT current_setting('data_directory') AS value")).rows[0].value;
  assert.equal(realpathSync(dataDirectory), realpathSync(process.env.ISOLATED_TEST_PGDATA));
  process.env.TELEGRAM_STAFF_ENABLED = "true";
  const role = (await pool.query("SELECT id FROM roles WHERE name='MANAGER'")).rows[0].id;
  const address = `staff-bot-${randomBytes(5).toString("hex")}@test.invalid`;
  const user = (await pool.query(`INSERT INTO users(first_name,email,password_hash,role_id)
    VALUES('Bot test',$1,'test',$2) RETURNING id`, [address, role])).rows[0];
  const chatId = 90000000 + Number(user.id);
  await pool.query(`INSERT INTO employee_profiles(user_id,staff_role,access_enabled,telegram_allowed,
    order_notifications_enabled) VALUES($1,'MANAGER',TRUE,TRUE,TRUE)`, [user.id]);
  const link = await issueMakatronStaffLink(user.id);
  const token = link.split("staff_")[1];
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.equal((await connectMakatronStaff({token,chatId,telegramUserId:chatId}))?.userId,user.id);
  assert.equal(await connectMakatronStaff({token,chatId,telegramUserId:chatId}),null,
    "a one-time staff link cannot be reused");
  assert.equal((await resolveMakatronStaff({ chatId, telegramUserId: chatId }))?.userId, user.id);

  await pool.query("UPDATE employee_profiles SET order_notifications_enabled=FALSE WHERE user_id=$1", [user.id]);
  const notificationDb = {
    query: async (sql) => {
      assert.match(sql, /order_notifications_enabled=TRUE/);
      return { rows: [] };
    },
  };
  assert.deepEqual(await sendPendingStaffOrderNotifications(async () => {}, { db: notificationDb }),
    { recipients: 0, sent: 0 });
  assert.ok(await resolveMakatronStaff({ chatId, telegramUserId: chatId }),
    "disabling notifications must not disable staff commands");

  const staleToken = (await issueMakatronStaffLink(user.id)).split("staff_")[1];
  await pool.query("UPDATE employee_profiles SET telegram_allowed=FALSE WHERE user_id=$1", [user.id]);
  assert.equal(await resolveMakatronStaff({ chatId, telegramUserId: chatId }), null);
  assert.equal(await connectMakatronStaff({token:staleToken,chatId,telegramUserId:chatId}),null,
    "a link issued before Telegram revocation cannot restore staff access");
  await pool.query("UPDATE employee_profiles SET access_enabled=FALSE WHERE user_id=$1", [user.id]);
  assert.equal(await resolveMakatronStaff({ chatId, telegramUserId: chatId }), null);
});
