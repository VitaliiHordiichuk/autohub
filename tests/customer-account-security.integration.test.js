import test, { after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import { AuthService } from "../src/services/AuthService.js";
import { CustomerManagementService } from "../src/services/CustomerManagementService.js";
import { PasswordResetService } from "../src/services/PasswordResetService.js";
import { hashSecret } from "../src/services/PasswordSecurityService.js";

process.env.EMAIL_DELIVERY_DISABLED = "true";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createdUserIds = [];
const createdCustomerIds = [];

after(async () => {
  if (createdCustomerIds.length) {
    await pool.query("DELETE FROM customer_history WHERE customer_id = ANY($1::integer[])", [createdCustomerIds]);
    await pool.query("DELETE FROM customers WHERE id = ANY($1::integer[])", [createdCustomerIds]);
  }
  if (createdUserIds.length) {
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = ANY($1::integer[])", [createdUserIds]);
    await pool.query("DELETE FROM user_delivery_profiles WHERE user_id = ANY($1::integer[])", [createdUserIds]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::integer[])", [createdUserIds]);
  }
  await pool.end();
});

test("реєстрація автоматично створює унікальний номер MAKA від 001358", async () => {
  const email = `security-register-${suffix}@autohub.local`;
  const registered = await AuthService.register({
    firstName: "Security",
    lastName: "Test",
    phone: "067 123 00 01",
    email,
    password: "InitialPassword42",
  });
  createdUserIds.push(Number(registered.user.id));
  createdCustomerIds.push(Number(registered.customer.id));

  assert.match(registered.customer.customerNumber, /^MAKA-[0-9]{6}$/);
  assert.equal(registered.user.phone, "+380671230001");
  assert.ok(Number(registered.customer.customerNumber.slice(5)) >= 1358);

  await assert.rejects(
    AuthService.register({
      firstName: "Duplicate",
      lastName: "Account",
      phone: "+380671230099",
      email,
      password: "AnotherPassword42",
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.apiCode, "ACCOUNT_ALREADY_EXISTS");
      return true;
    },
  );
});

test("одноразове посилання змінює пароль, вимикає прапорець і не працює повторно", async () => {
  const registered = await AuthService.register({
    firstName: "Reset",
    lastName: "Link",
    phone: "+380671230002",
    email: `security-link-${suffix}@autohub.local`,
    password: "InitialPassword42",
  });
  const userId = Number(registered.user.id);
  createdUserIds.push(userId);
  createdCustomerIds.push(Number(registered.customer.id));
  const rawToken = `test-${suffix}`;

  await pool.query(
    `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
     VALUES($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
    [userId, hashSecret(rawToken)]
  );
  await PasswordResetService.resetWithToken({
    token: rawToken,
    password: "NewPasswordForLink42",
    ipAddress: "127.0.0.1",
  });

  const login = await AuthService.login({
    email: `security-link-${suffix}@autohub.local`,
    password: "NewPasswordForLink42",
  });
  assert.equal(login.user.mustChangePassword, false);
  await assert.rejects(
    PasswordResetService.resetWithToken({
      token: rawToken,
      password: "AnotherPassword42",
      ipAddress: "127.0.0.1",
    }),
    (error) => error?.code === "RESET_TOKEN_INVALID"
  );
});

test("адмінський сброс відкликає стару сесію і вимагає змінити тимчасовий пароль", async () => {
  const registered = await AuthService.register({
    firstName: "Admin",
    lastName: "Reset",
    phone: "+380671230003",
    email: `security-admin-${suffix}@autohub.local`,
    password: "InitialPassword42",
  });
  const userId = Number(registered.user.id);
  const customerId = Number(registered.customer.id);
  createdUserIds.push(userId);
  createdCustomerIds.push(customerId);
  const oldSession = await AuthService.login({
    email: `security-admin-${suffix}@autohub.local`,
    password: "InitialPassword42",
  });
  const admin = await pool.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'ADMIN' ORDER BY u.id LIMIT 1`
  );
  assert.ok(admin.rows[0]);

  const reset = await PasswordResetService.resetCustomerByStaff({
    customerId,
    actorUserId: admin.rows[0].id,
    actorRole: "ADMIN",
    locale: "uk",
    ipAddress: "127.0.0.1",
  });
  assert.match(reset.temporaryPassword, /^MAKA-[A-Z2-9]{8}$/);
  await assert.rejects(AuthService.verifySessionToken(oldSession.token));

  const temporaryLogin = await AuthService.login({
    email: `security-admin-${suffix}@autohub.local`,
    password: reset.temporaryPassword,
  });
  assert.equal(temporaryLogin.user.mustChangePassword, true);

  await PasswordResetService.changeForcedPassword({
    userId,
    password: "FinalCustomerPassword42",
    ipAddress: "127.0.0.1",
  });
  const finalLogin = await AuthService.login({
    email: `security-admin-${suffix}@autohub.local`,
    password: "FinalCustomerPassword42",
  });
  assert.equal(finalLogin.user.mustChangePassword, false);
});

test("адмін створює клієнта з ручним номером, а менеджеру пароль не повертається", async () => {
  const admin = await pool.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'ADMIN' ORDER BY u.id LIMIT 1`
  );
  const next = await CustomerManagementService.getNextCustomerNumber();
  assert.match(next.customerNumber, /^MAKA-[0-9]{6}$/);

  const created = await CustomerManagementService.createCustomer(
    {
      firstName: "Manual",
      lastName: "Number",
      phone: "+380671230004",
      email: `security-create-${suffix}@autohub.local`,
      customerNumber: next.customerNumber,
      customerType: "REGISTERED",
      locale: "uk",
    },
    { userId: admin.rows[0].id, role: "ADMIN" }
  );
  createdUserIds.push(Number(created.userId));
  createdCustomerIds.push(Number(created.id));
  assert.equal(created.customerNumber, next.customerNumber);
  assert.match(created.temporaryPassword, /^MAKA-[A-Z2-9]{8}$/);

  const managerView = await PasswordResetService.resetCustomerByStaff({
    customerId: created.id,
    actorUserId: admin.rows[0].id,
    actorRole: "MANAGER",
    locale: "uk",
    ipAddress: "127.0.0.1",
  });
  assert.equal(managerView.temporaryPassword, null);
});
