const PHONE = "+380 50 811 33 35";

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid order amount");
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH" }).format(amount);
}

export function buildOrderEmail({ type, order, items = [], trackingNumber }) {
  const id = Number(order.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid order ID");
  let subject, content, text, idempotencyKey;
  if (type === "confirmed") {
    if (!items.length) throw new Error("Cannot email an empty order");
    subject = `Замовлення №${id} підтверджено — MAKA`;
    const rows = items.map(item => {
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invalid order quantity");
      const name = String(item.name || "").trim();
      const article = String(item.article || "");
      // Only the customer's saved sale price; never purchase/supplier costs.
      const price = money(item.price_at_purchase);
      const total = money(Number(item.price_at_purchase) * quantity);
      return {
        html: `<tr><td style="padding:14px 0;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere"><strong>${escapeHtml(article)}</strong>${name ? `<br>${escapeHtml(name)}` : ""}<br><span style="color:#667078">${quantity} × ${escapeHtml(price)}</span></td><td align="right" style="padding:14px 0;border-bottom:1px solid #e5e7eb;white-space:nowrap;vertical-align:top">${escapeHtml(total)}</td></tr>`,
        text: `${article}${name ? ` — ${name}` : ""}: ${quantity} × ${price} = ${total}`,
      };
    });
    const total = money(order.total_amount);
    content = `<h1 style="font-size:26px;line-height:1.25;margin:0 0 12px">Замовлення підтверджено</h1><p style="margin:0 0 16px;color:#667078">Замовлення №${id}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.map(r => r.html).join("")}</table><p style="font-size:20px;margin:22px 0 0"><strong>Сума: ${escapeHtml(total)}</strong></p>`;
    text = `Замовлення №${id} підтверджено\n\n${rows.map(r => r.text).join("\n")}\n\nСума: ${total}`;
    idempotencyKey = `maka/order-confirmed/${id}`;
  } else if (type === "tracking") {
    const ttn = String(trackingNumber || "");
    if (!/^\d{14}$/.test(ttn)) throw new Error("Invalid tracking number");
    const url = `https://novaposhta.ua/tracking/?cargo_number=${ttn}`;
    subject = `ТТН замовлення №${id} — MAKA`;
    // A saved shipping label does not prove the parcel has been handed over.
    content = `<h1 style="font-size:26px;line-height:1.25;margin:0 0 12px">ТТН Нової пошти</h1><p style="margin:0 0 22px;color:#667078">Замовлення №${id}</p><p style="font-size:24px;font-weight:bold;letter-spacing:1px;margin:0 0 24px">${ttn}</p><a href="${url}" style="display:inline-block;padding:14px 20px;background:#17191b;color:#ffffff;text-decoration:none;border-radius:4px">Відстежити посилку →</a>`;
    text = `Замовлення №${id}\nТТН Нової пошти: ${ttn}\n\nВідстежити посилку: ${url}`;
    idempotencyKey = `maka/order-tracking/${id}/${ttn}`;
  } else {
    throw new Error("Unknown order email type");
  }
  return {
    subject, idempotencyKey,
    text: `${text}\n\nMAKA.com.ua\n${PHONE}\nhttps://maka.com.ua`,
    html: `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#f3f4f5;font-family:Arial,Helvetica,sans-serif;color:#17191b;line-height:1.5"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff"><tr><td style="padding:24px;background:#101214;color:#ffffff;font-size:25px;letter-spacing:4px;font-weight:bold">MAKA<span style="font-size:13px;letter-spacing:0;font-weight:normal;color:#bec3c7">.com.ua</span></td></tr><tr><td style="padding:28px 24px">${content}</td></tr><tr><td style="padding:20px 24px;border-top:1px solid #e5e7eb;color:#667078;font-size:14px"><a href="tel:+380508113335" style="color:#17191b;text-decoration:none">${PHONE}</a><br><a href="https://maka.com.ua" style="color:#667078;text-decoration:none">maka.com.ua</a></td></tr></table></td></tr></table></body></html>`,
  };
}
