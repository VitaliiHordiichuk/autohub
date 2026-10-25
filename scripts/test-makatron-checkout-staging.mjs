// Full order smoke on a TEMPORARY RESTORED DATABASE ONLY.
// Run with DB_NAME=autohub_makatron_test_<timestamp> NODE_ENV=test.
// Never connects to Telegram and does not call the production website.
import "dotenv/config";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { pool } from "../src/config/db.js";
import { CartAccessRepository } from "../src/repositories/CartAccessRepository.js";
import { CartService } from "../src/services/CartService.js";
import { StartCheckout } from "../src/use-cases/checkout/StartCheckout.js";
import { SubmitOrder } from "../src/use-cases/checkout/SubmitOrder.js";
import { TelegramGuestOrderRecipientRepository } from "../src/repositories/TelegramGuestOrderRecipientRepository.js";
import { TelegramShoppingCartRepository } from "../src/repositories/TelegramShoppingCartRepository.js";
import { OrderConfirmationService } from "../src/services/OrderConfirmationService.js";
import { telegramOrderManagerComment } from "../src/services/TelegramOrderCustomerService.js";

async function run() {
  const dbName=String(process.env.DB_NAME||"");
  if(!/^autohub_makatron_test_[a-z0-9_]+$/.test(dbName) ||
      process.env.NODE_ENV!=="test") {
    throw Error("REFUSED: requires temporary autohub_makatron_test_* DB and NODE_ENV=test");
  }
  const actual=(await pool.query("SELECT current_database() AS name")).rows[0].name;
  if(actual!==dbName)throw Error("REFUSED: connection points to unexpected database");

  const demo=[
    {article:"A2711800109",name:"Фільтр",quantity:2,selectedOffer:0,
      offers:[{offerId:2143,sourceType:"OWN_STOCK",quantity:5,price:125}]},
  ];
  await TelegramShoppingCartRepository.put(953723985,953723985,demo);
  assert.deepEqual(await TelegramShoppingCartRepository.get(953723985,953723985),demo);
  assert.deepEqual(await TelegramShoppingCartRepository.get(953723986,953723986),[]);
  await TelegramShoppingCartRepository.clear(953723985,953723985);
  assert.deepEqual(await TelegramShoppingCartRepository.get(953723985,953723985),[]);
  console.log("SUCCESS staging persistent-cart DB round trip: saved, identity-scoped, cleared");

  // Prefer a local owned stock item; no actual person or order data is modified
  // because this is a staging-only restored database.
  const candidates=await pool.query(`
    SELECT po.id AS offer_id, p.article, po.quantity,
           w.id AS pickup_warehouse_id
    FROM product_offers po
    JOIN products p ON p.id=po.product_id
    JOIN warehouses w ON w.id=po.warehouse_id
    LEFT JOIN suppliers s ON s.id=COALESCE(po.supplier_id,w.supplier_id)
    WHERE w.type='OWN' AND w.is_active=TRUE
      AND (s.type IS NULL OR s.type='OWN')
      AND (s.is_active IS DISTINCT FROM FALSE)
      AND po.is_available=TRUE AND po.is_hidden IS DISTINCT FROM TRUE
      AND po.quantity>=2 AND (
        CASE WHEN po.price_mode='MANUAL' AND po.manual_retail_price IS NOT NULL
          THEN po.manual_retail_price ELSE po.retail_price END
      )>0
    ORDER BY po.quantity DESC,po.id
    LIMIT 25
  `);
  if(!candidates.rows.length) throw Error("No owned-stock offers to test in staging DB");

  let chosen=null,cart=null,token=null;
  for(const offer of candidates.rows) {
    token=randomBytes(32).toString("hex");
    cart=await CartAccessRepository.createForGuest(
      createHash("sha256").update(token).digest("hex"));
    try {
      await CartService.addProduct({
        cartId:cart.id,guestToken:token,userId:null,
        productOfferId:offer.offer_id,quantity:1,
      });
      chosen=offer;break;
    } catch(e) {
      if(!/Недостатньо товару|Товар недоступний/.test(String(e.message)))throw e;
    }
  }
  if(!chosen)throw Error("No checkout-eligible owned stock offer in staging");

  const checkout=await StartCheckout.execute({
    cartId:cart.id,userId:null,guestToken:token,
  });
  assert.equal(checkout.inventoryModel,"COMMIT_ON_SUBMIT");
  assert.equal(checkout.items.length,1);
  const before=(await pool.query(
    "SELECT quantity FROM product_offers WHERE id=$1",[chosen.offer_id])).rows[0];
  const key=randomUUID();
  const delivery={
    recipientFirstName:"MAKAtron",recipientLastName:"Тест",
    recipientPhone:"+380501234567",deliveryMethod:"PICKUP",
  };
  const first=await SubmitOrder.execute({
    checkoutId:checkout.checkoutId,idempotencyKey:key,
    userId:null,guestToken:token,delivery,saveDeliveryProfile:false,
    comment:telegramOrderManagerComment("Перетелефонуйте перед видачею"),
  });
  const ids=first.orders.map(order=>Number(order.id));
  assert.equal(ids.length,1);
  const after=Number((await pool.query(
    "SELECT quantity FROM product_offers WHERE id=$1",[chosen.offer_id])).rows[0].quantity);
  assert.equal(after,Number(before.quantity)-1,"own stock must decrease exactly once");
  const replay=await SubmitOrder.execute({
    checkoutId:checkout.checkoutId,idempotencyKey:key,
    userId:null,guestToken:token,delivery,saveDeliveryProfile:false,
  });
  assert.equal(replay.idempotentReplay,true);
  assert.deepEqual(replay.orders.map(order=>Number(order.id)),ids);
  const afterReplay=Number((await pool.query(
    "SELECT quantity FROM product_offers WHERE id=$1",[chosen.offer_id])).rows[0].quantity);
  assert.equal(afterReplay,after,"replay must not deduct stock twice");
  const saved=(await pool.query("SELECT status,inventory_model FROM orders WHERE id=$1",[ids[0]])).rows[0];
  assert.equal(saved.inventory_model,"COMMIT_ON_SUBMIT");
  const shipping=(await pool.query(
    "SELECT delivery_method,pickup_warehouse_id FROM order_delivery_details WHERE order_id=$1",
    [ids[0]]
  )).rows[0];
  assert.equal(shipping.delivery_method,"PICKUP");
  assert.equal(shipping.pickup_warehouse_id,null,
    "manager-arranged pickup must never bind an internal warehouse ID");
  const note=(await pool.query("SELECT comment FROM orders WHERE id=$1",[ids[0]])).rows[0].comment;
  assert.match(note,/Коментарій клієнта: Перетелефонуйте перед видачею/);
  await TelegramGuestOrderRecipientRepository.saveOrders({
    orderIds:ids,chatId:953723985,telegramUserId:953723985,
  });
  const guest=(await pool.query(
    "SELECT telegram_chat_id FROM telegram_guest_order_recipients WHERE order_id=$1",
    [ids[0]])).rows[0];
  assert.equal(String(guest.telegram_chat_id),"953723985");
  const confirmed=await OrderConfirmationService.confirmOrder({orderId:ids[0]});
  assert.equal(confirmed.order.status,"CONFIRMED");
  console.log("SUCCESS staging checkout: generic PICKUP, optional comment saved, guest recipient retained, manager confirmed order, stock committed once and retry idempotent");
  console.log("Offer id: "+chosen.offer_id+", stock: "+before.quantity+" -> "+after);
  console.log("No changes made to live MAKA database or bot.");
}
try{await run();}
catch(e){console.error("STAGING CHECK FAILED:",e.message);process.exitCode=1;}
finally{await pool.end();}
