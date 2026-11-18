import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderEmail } from "./OrderEmailTemplate.js";
import { OrderEmailNotificationService } from "./OrderEmailNotificationService.js";
import { EmailService } from "./EmailService.js";
import { pool } from "../config/db.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";
import { OrderConfirmationService } from "./OrderConfirmationService.js";
import { OrderTrackingService } from "./OrderTrackingService.js";
import { TelegramNotificationService } from "./TelegramNotificationService.js";

const order = { id: 900000001, status: "CONFIRMED", total_amount: "2500.00",
  recipient_email: "order@example.invalid", delivery_method: "NOVA_POSHTA_POINT", tracking_number: "00000000000000" };
const items = [{ article: "A0004209602", name: "Тестові колодки <script>", quantity: 2,
  price_at_purchase: "1250.00", purchase_price: 987654321, purchase_price_at_confirmation: 987654321,
  supplier_name: "PRIVATE_SUPPLIER" }];

function enabled(t) {
  for (const [key, value] of Object.entries({ ORDER_EMAIL_NOTIFICATIONS_ENABLED: "true", EMAIL_DELIVERY_DISABLED: "false",
    RESEND_API_KEY: "test-only-key", EMAIL_FROM: "MAKA.com.ua <no-reply@maka.com.ua>" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
}
function database(row = order) {
  const calls = [];
  return { calls, async query(sql, args) {
    calls.push({ sql, args });
    return { rows: sql.includes("FROM order_items") ? items : row ? [row] : [] };
  } };
}

test("confirmation includes sale prices and escapes product text, never exposes private costs", () => {
  const email = buildOrderEmail({ type: "confirmed", order, items });
  assert.match(email.subject, /900000001.*MAKA/);
  assert.match(email.html, /A0004209602/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>|987654321|PRIVATE_SUPPLIER/);
  assert.doesNotMatch(email.text, /987654321|PRIVATE_SUPPLIER/);
  assert.match(email.text, /2 ×/);
  assert.match(email.text, /2\s?500,00/);
  assert.equal(email.idempotencyKey, "maka/order-confirmed/900000001");
});

test("tracking retains leading zeroes, provides official tracking URL and does not claim shipment", () => {
  const email = buildOrderEmail({ type: "tracking", order, trackingNumber: "00000000000000" });
  assert.match(email.html, /00000000000000/);
  assert.match(email.text, /https:\/\/novaposhta.ua\/tracking\/\?cargo_number=00000000000000/);
  assert.doesNotMatch(email.html, /відправлено|987654321/);
  assert.equal(email.idempotencyKey, "maka/order-tracking/900000001/00000000000000");
});

test("malformed IDs, TTN, empty items and invalid money cannot become email content", () => {
  assert.throws(() => buildOrderEmail({ type: "tracking", order, trackingNumber: "<invalid>" }));
  assert.throws(() => buildOrderEmail({ type: "tracking", order: { id: "bad" }, trackingNumber: "00000000000000" }));
  assert.throws(() => buildOrderEmail({ type: "confirmed", order, items: [] }));
  assert.throws(() => buildOrderEmail({ type: "confirmed", order, items: [{ ...items[0], price_at_purchase: "NaN" }] }));
});

test("disabled or unconfigured order email does not query orders or send", async t => {
  enabled(t); const db = database(); const transport = () => assert.fail("Unexpected email");
  process.env.ORDER_EMAIL_NOTIFICATIONS_ENABLED = "false";
  assert.equal((await OrderEmailNotificationService.send({ orderId: order.id, type: "confirmed" }, db, transport)).reason, "DISABLED");
  process.env.ORDER_EMAIL_NOTIFICATIONS_ENABLED = "true"; process.env.EMAIL_DELIVERY_DISABLED = "true";
  assert.equal((await OrderEmailNotificationService.send({ orderId: order.id, type: "confirmed" }, db, transport)).reason, "DISABLED");
  process.env.EMAIL_DELIVERY_DISABLED = "false"; process.env.RESEND_API_KEY = "";
  assert.equal((await OrderEmailNotificationService.send({ orderId: order.id, type: "confirmed" }, db, transport)).reason, "NOT_CONFIGURED");
  assert.equal(db.calls.length, 0);
});

test("guest and account orders send to the email saved in that order only", async t => {
  enabled(t);
  for (const created_by of [null, 42]) {
    const db = database({ ...order, created_by, email: "unrelated-profile@example.invalid" }); const sent = [];
    const result = await OrderEmailNotificationService.send({ orderId: order.id, type: "confirmed" }, db,
      async email => { sent.push(email); return { sent: true }; });
    assert.equal(result.sent, true); assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "order@example.invalid");
    assert.doesNotMatch(db.calls[1].sql, /purchase_price|supplier|internal_cost/);
    assert.deepEqual(db.calls[0].args, [order.id]);
  }
});

test("missing and invalid order emails do not fall back to a profile address", async t => {
  enabled(t);
  for (const recipient_email of [null, "", "bad", "a@b.com\r\nBcc: victim@example.invalid"]) {
    const db = database({ ...order, recipient_email, email: "profile@example.invalid" });
    const result = await OrderEmailNotificationService.send({ orderId: order.id, type: "confirmed" }, db, () => assert.fail("Unexpected email"));
    assert.equal(result.reason, "NO_VALID_ORDER_EMAIL"); assert.equal(db.calls.length, 1);
  }
});

test("new Nova Poshta TTN sends for guests and skips stale numbers and pickup", async t => {
  enabled(t); const sent = [];
  const transport = async input => { sent.push(input); return { sent: true }; };
  for (const delivery_method of ["NOVA_POSHTA_POINT", "NOVA_POSHTA_COURIER"]) {
    assert.equal((await OrderEmailNotificationService.send({ orderId: order.id, type: "tracking", trackingNumber: order.tracking_number }, database({ ...order, delivery_method }), transport)).sent, true);
  }
  for (const row of [{ ...order, delivery_method: "PICKUP" }, { ...order, tracking_number: "11111111111111" }]) {
    assert.equal((await OrderEmailNotificationService.send({ orderId: order.id, type: "tracking", trackingNumber: order.tracking_number }, database(row), transport)).reason, "TRACKING_CHANGED");
  }
  assert.equal(sent.length, 2);
});

test("cancelled orders do not produce a stale confirmation", async t => {
  enabled(t);
  assert.equal((await OrderEmailNotificationService.send({ orderId: order.id, type: "confirmed" },
    database({ ...order, status: "CANCELLED" }), () => assert.fail("Unexpected email"))).reason, "STATUS_CHANGED");
});

test("delivery failure cannot fail an order action and logs no address or key", async t => {
  enabled(t); const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
  const result = await OrderEmailNotificationService.send({ orderId: order.id, type: "confirmed" }, database(),
    async () => { throw new Error("order@example.invalid SECRET_PROVIDER_RESPONSE"); });
  assert.equal(result.reason, "SEND_FAILED");
  assert.doesNotMatch(JSON.stringify(logs), /example.invalid|SECRET_PROVIDER_RESPONSE|test-only-key/);
});

test("Resend receives configured sender and stable idempotency key on a transient retry", async t => {
  enabled(t); const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(requests.length === 1 ? { message: "Temporary error" } : { id: "fake-email-id" }),
      { status: requests.length === 1 ? 503 : 200 });
  });
  const result = await EmailService.sendOrderNotification({ to: order.recipient_email, ...buildOrderEmail({ type: "confirmed", order, items }) });
  assert.equal(result.sent, true); assert.equal(requests.length, 2);
  assert.equal(requests[0].options.body, requests[1].options.body);
  assert.equal(requests[0].options.headers["Idempotency-Key"], requests[1].options.headers["Idempotency-Key"]);
  assert.equal(JSON.parse(requests[0].options.body).from, "MAKA.com.ua <no-reply@maka.com.ua>");
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.ok(requests[0].options.signal);
});

test("permanent provider errors are not retried; disabled delivery makes zero network calls", async t => {
  enabled(t); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }); });
  const input = { to: order.recipient_email, ...buildOrderEmail({ type: "confirmed", order, items }) };
  await assert.rejects(EmailService.sendOrderNotification(input)); assert.equal(calls, 1);
  process.env.EMAIL_DELIVERY_DISABLED = "true";
  assert.equal((await EmailService.sendOrderNotification(input)).skipped, true); assert.equal(calls, 1);
});

test("existing password reset emails keep their payload and do not inherit order deduplication", async t => {
  enabled(t); const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(options); return new Response(JSON.stringify({ id: "password-email-test" }), { status: 200 });
  });
  const result = await EmailService.sendPasswordResetLink({ to: "account@example.invalid", firstName: "Олена", locale: "uk", resetUrl: "https://maka.com.ua/uk/reset-password?token=synthetic" });
  assert.equal(result.sent, true); assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["Idempotency-Key"], undefined);
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body.to, ["account@example.invalid"]); assert.match(body.subject, /Відновлення пароля/);
});

function workflow(t, { status = "NEW", tracking = null, failCommit = false } = {}) {
  const events = []; const row = { ...order, status, created_by: null, inventory_model: "COMMIT_ON_SUBMIT", tracking_number: tracking };
  const client = { async query(sql) {
    if (sql === "COMMIT" && failCommit) throw new Error("Commit failed");
    events.push(sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" ? sql : "QUERY");
    return { rows: [{ ...row, tracking_number: "00000000000000" }] };
  }, release() {} };
  t.mock.method(pool, "connect", async () => client);
  t.mock.method(OrderRepository, "findByIdForUpdate", async () => row);
  t.mock.method(OrderRepository, "findItemsByOrderId", async () => items);
  t.mock.method(OrderRepository, "confirmPurchasePrices", async () => items);
  t.mock.method(OrderRepository, "updateStatus", async () => ({ ...row, status: "CONFIRMED" }));
  t.mock.method(OrderRepository, "addStatusHistory", async () => ({}));
  t.mock.method(NotificationRepository, "createForUser", async () => ({}));
  t.mock.method(TelegramNotificationService, "sendOrderStatusToUser", async () => {});
  t.mock.method(TelegramNotificationService, "sendTrackingToUser", async () => ({ sent: false }));
  t.mock.method(OrderEmailNotificationService, "send", async input => { assert.ok(events.includes("COMMIT")); events.push(input.type); return { sent: true }; });
  return events;
}

test("confirmation triggers email after commit, never before or on rollback", async t => {
  const events = workflow(t);
  const result = await OrderConfirmationService.confirmOrder({ orderId: order.id });
  assert.equal(result.order.status, "CONFIRMED");
  assert.ok(events.indexOf("confirmed") > events.indexOf("COMMIT"));
  assert.equal(events.filter(x => x === "confirmed").length, 1);
});

test("failed transaction sends no confirmation email", async t => {
  const events = workflow(t, { failCommit: true });
  await assert.rejects(OrderConfirmationService.confirmOrder({ orderId: order.id }), /Commit failed/);
  assert.ok(events.includes("ROLLBACK")); assert.ok(!events.includes("confirmed"));
});

test("guest TTN update triggers email after commit and preserves existing Telegram behavior", async t => {
  const events = workflow(t);
  const result = await OrderTrackingService.update({ orderId: order.id, trackingNumber: "00000000000000", changedBy: 1 });
  assert.equal(result.changed, true); assert.equal(result.telegram.reason, "CUSTOMER_NOT_REGISTERED");
  assert.ok(events.indexOf("tracking") > events.indexOf("COMMIT"));
});

test("re-saving identical TTN sends no email", async t => {
  const events = workflow(t, { tracking: "00000000000000" });
  const result = await OrderTrackingService.update({ orderId: order.id, trackingNumber: "00000000000000", changedBy: 1 });
  assert.equal(result.changed, false); assert.ok(!events.includes("tracking"));
});

test("failed TTN commit does not send email", async t => {
  const events = workflow(t, { failCommit: true });
  await assert.rejects(OrderTrackingService.update({ orderId: order.id, trackingNumber: "00000000000000", changedBy: 1 }), /Commit failed/);
  assert.ok(events.includes("ROLLBACK")); assert.ok(!events.includes("tracking"));
});
