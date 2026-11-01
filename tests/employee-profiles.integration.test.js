import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { app } from "../src/app.js";
import { pool } from "../src/config/db.js";
import { EmployeeAdminService } from "../src/services/EmployeeAdminService.js";
import { AuthService } from "../src/services/AuthService.js";
import { CustomerPricingService } from "../src/services/CustomerPricingService.js";
import { requireRole } from "../src/middleware/auth.middleware.js";

const localSocket = String(process.env.DB_HOST || "").startsWith("/private/tmp/");
const isolated = localSocket && /_test$/.test(String(process.env.DB_NAME || "")) &&
  process.env.ISOLATED_TEST_DB_CONFIRMATION === "LOCAL_TEST_CLUSTER_ONLY";
let server;
test.after(async () => {
  if (server) await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
});

test("customer and work profile remain separate through staff lifecycle", {
  skip: !isolated ? "requires explicitly confirmed isolated local PostgreSQL" : false,
}, async () => {
  const dataDirectory = (await pool.query("SELECT current_setting('data_directory') AS value")).rows[0].value;
  assert.equal(realpathSync(dataDirectory),realpathSync(process.env.ISOLATED_TEST_PGDATA));
  const suffix = randomBytes(5).toString("hex");
  const adminEmail = "employee-admin-" + suffix + "@test.invalid";
  const clientEmail = "employee-client-" + suffix + "@test.invalid";
  const role = async (name) => {
    const result = await pool.query("SELECT id FROM roles WHERE name=$1",[name]);
    return result.rows[0]?.id;
  };
  const adminRole = await role("ADMIN");
  const clientRole = await role("CLIENT");
  assert.ok(adminRole && clientRole);
  const admin = (await pool.query(
    "INSERT INTO users(first_name,email,password_hash,role_id) VALUES('Admin',$1,'test',$2) RETURNING id",
    [adminEmail,adminRole])).rows[0];
  const client = (await pool.query(
    "INSERT INTO users(first_name,email,password_hash,role_id) VALUES('Client',$1,'test',$2) RETURNING id",
    [clientEmail,clientRole])).rows[0];
  const customer = (await pool.query(
    "INSERT INTO customers(user_id,customer_type) VALUES($1,'REGISTERED') RETURNING id",
    [client.id])).rows[0];
  const historicalOrder = (await pool.query(`INSERT INTO orders(customer_id,created_by,status,total_amount)
    VALUES($1,$2,'CONFIRMED',100) RETURNING id`,[customer.id,client.id])).rows[0];
  await pool.query(
    "INSERT INTO employee_profiles(user_id,staff_role,access_enabled) VALUES($1,'ADMIN',TRUE)",
    [admin.id]);
  await assert.rejects(EmployeeAdminService.setActive(admin.id,false,admin.id),/Менеджер не найден/);
  await assert.rejects(EmployeeAdminService.remove(admin.id,admin.id),/Менеджер не найден/);

  const appointed = await EmployeeAdminService.create(
    {mode:"existing",email:clientEmail},admin.id);
  assert.equal(Number(appointed.id),Number(client.id));
  assert.equal(appointed.has_customer_profile,true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE email=$1",[clientEmail])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM customers WHERE user_id=$1",[client.id])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders WHERE id=$1 AND customer_id=$2",
    [historicalOrder.id,customer.id])).rows[0].n,1);
  await EmployeeAdminService.setPricingPermission(client.id,true,admin.id);
  await assert.rejects(
    EmployeeAdminService.create({mode:"new",email:clientEmail,firstName:"Duplicate",password:"password123"},admin.id),
    /існує/);

  const staffSession = await AuthService.createSessionForUser(client.id);
  assert.equal(staffSession.user.role,"MANAGER");
  server = app.listen(0);
  await new Promise(resolve => server.once("listening",resolve));
  const employeeUrl = `http://127.0.0.1:${server.address().port}/api/admin/employees`;
  const adminSession = await AuthService.createSessionForUser(admin.id);
  assert.equal((await fetch(employeeUrl,{headers:{Cookie:`autohub_token=${adminSession.token}`}})).status,200);
  assert.equal((await fetch(employeeUrl,{headers:{Cookie:`autohub_token=${staffSession.token}`}})).status,403);
  const activeStaffAuth = await AuthService.verifySessionToken(staffSession.token);
  assert.equal(activeStaffAuth.role,"MANAGER");
  assert.equal(activeStaffAuth.hasCustomerProfile,true);
  let clientRouteAllowed = false;
  requireRole("CLIENT")({auth:activeStaffAuth}, {status(){throw new Error("Client access denied");}},
    () => { clientRouteAllowed = true; });
  assert.equal(clientRouteAllowed,true);
  let adminDenied = false;
  requireRole("ADMIN")({auth:activeStaffAuth}, {status(code){
    assert.equal(code,403);return {json(){adminDenied=true;}};
  }}, () => {throw new Error("Manager entered admin route");});
  assert.equal(adminDenied,true);
  const clientPrice = await CustomerPricingService.getContext(client.id);
  assert.equal(clientPrice.priceGroupName,"Registered");
  assert.equal(clientPrice.showAllPrices,true);
  await EmployeeAdminService.setTelegramAllowed(client.id,true,admin.id);
  await EmployeeAdminService.setOrderNotifications(client.id,true,admin.id);
  await EmployeeAdminService.setTelegramAllowed(client.id,false,admin.id);
  assert.equal((await pool.query("SELECT order_notifications_enabled FROM employee_profiles WHERE user_id=$1",
    [client.id])).rows[0].order_notifications_enabled,false);
  await EmployeeAdminService.setTelegramAllowed(client.id,true,admin.id);
  await EmployeeAdminService.setOrderNotifications(client.id,true,admin.id);
  const link = await EmployeeAdminService.createTelegramLink(client.id,admin.id);
  assert.match(link.url,/^https:\/\/t\.me\/MAKA_com_ua_bot\?start=staff_[a-f0-9]{48}$/);
  await pool.query(
    "INSERT INTO makatron_staff_links(user_id,telegram_chat_id,telegram_user_id) VALUES($1,99901,99901)",
    [client.id]);
  await EmployeeAdminService.setOrderNotifications(client.id,false,admin.id);
  assert.equal((await pool.query("SELECT notifications_enabled FROM makatron_staff_links WHERE user_id=$1",
    [client.id])).rows[0].notifications_enabled,false);
  await EmployeeAdminService.setOrderNotifications(client.id,true,admin.id);
  assert.equal((await pool.query("SELECT notifications_enabled FROM makatron_staff_links WHERE user_id=$1",
    [client.id])).rows[0].notifications_enabled,true);
  await EmployeeAdminService.setActive(client.id,false,admin.id);
  await assert.rejects(AuthService.verifySessionToken(staffSession.token));
  assert.equal((await fetch(employeeUrl,{headers:{Cookie:`autohub_token=${staffSession.token}`}})).status,401);
  assert.equal((await AuthService.createSessionForUser(client.id)).user.role,"CLIENT");
  assert.equal((await CustomerPricingService.getContext(client.id)).showAllPrices,false);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM makatron_staff_links WHERE user_id=$1",[client.id])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM makatron_staff_link_tokens WHERE user_id=$1",[client.id])).rows[0].n,0);

  await EmployeeAdminService.setActive(client.id,true,admin.id);
  assert.equal((await AuthService.createSessionForUser(client.id)).user.role,"MANAGER");
  await EmployeeAdminService.remove(client.id,admin.id);
  assert.equal((await AuthService.createSessionForUser(client.id)).user.role,"CLIENT");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE id=$1",[client.id])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM customers WHERE user_id=$1",[client.id])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders WHERE id=$1 AND customer_id=$2 AND created_by=$3",
    [historicalOrder.id,customer.id,client.id])).rows[0].n,1);
  assert.equal((await EmployeeAdminService.list()).some(row=>Number(row.id)===Number(client.id)),false);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS n FROM audit_logs WHERE entity_type='EMPLOYEE' AND entity_id=$1",
    [client.id])).rows[0].n >= 5,true);
  const removal = (await pool.query(`SELECT old_value FROM audit_logs
    WHERE entity_type='EMPLOYEE' AND entity_id=$1 AND action='EMPLOYEE_REMOVED'
    ORDER BY id DESC LIMIT 1`,[client.id])).rows[0];
  assert.equal(JSON.parse(removal.old_value).had_manager_permissions,true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM manager_permissions WHERE user_id=$1",
    [client.id])).rows[0].n,0);

  const created = await EmployeeAdminService.create({
    mode:"new",email:"employee-only-"+suffix+"@test.invalid",
    firstName:"Work",password:"temporary123",
  },admin.id);
  assert.equal(created.has_customer_profile,false);
  await EmployeeAdminService.setActive(created.id,false,admin.id);
  await assert.rejects(AuthService.createSessionForUser(created.id),/вимкнено/);
  await assert.rejects(AuthService.login({
    email:"employee-only-"+suffix+"@test.invalid",password:"temporary123",
  }),/вимкнено/);
});
