// Read-only integration check on a disposable clone of MAKA production DB.
// NEVER point this script at the real autohub database.
import "dotenv/config";
import assert from "node:assert/strict";
import { pool } from "../src/config/db.js";
import { SearchService } from "../src/services/SearchService.js";
import { CustomerPricingService } from "../src/services/CustomerPricingService.js";
import { GetManagerOrder } from "../src/use-cases/manager/GetManagerOrder.js";
import { formatStaffNewOrder } from "../src/services/MakatronStaffService.js";
import { searchMakatronStaffPrices,buildMakatronClientQuote } from "../src/services/MakatronStaffPricingService.js";

const database=String(process.env.DB_NAME||"");
if(!/^autohub_makatron_staff_stage_[a-zA-Z0-9_]+$/.test(database)){
  console.error("REFUSED: DB_NAME must be autohub_makatron_staff_stage_*");
  process.exit(2);
}
async function check(){
  const migration=await pool.query(
    "SELECT version FROM schema_migrations WHERE version='117_makatron_staff_orders_quotes'"
  );
  assert.equal(migration.rowCount,1,"Migration 117 missing");
  const people=await pool.query(
    "SELECT u.id,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id "+
    "WHERE u.is_active=TRUE AND r.name IN ('ADMIN','MANAGER') ORDER BY u.id LIMIT 1"
  );
  assert.equal(people.rowCount,1,"Need an active MAKA ADMIN/MANAGER user");
  const staffUserId=Number(people.rows[0].id);
  const context=await CustomerPricingService.getContext(staffUserId);
  assert.equal(context.showAllPrices,true,"Staff price matrix missing");

  const record=await pool.query(
    "SELECT p.article,p.id AS product_id,po.id AS offer_id,c.unit_cost "+
    "FROM product_offers po JOIN products p ON p.id=po.product_id "+
    "JOIN warehouses w ON w.id=po.warehouse_id "+
    "JOIN product_offer_internal_costs c ON c.product_offer_id=po.id "+
    "WHERE po.warehouse_id=1 AND po.quantity>0 AND po.is_available=TRUE "+
    "AND po.is_hidden=FALSE AND w.is_active=TRUE "+
    "AND po.retail_price>0 ORDER BY po.id DESC LIMIT 15"
  );
  assert.ok(record.rows.length>0,"No stocked Mercedes offers with private incoming cost");
  let verified=null;
  for(const sample of record.rows){
    const search=await SearchService.searchByArticle(sample.article);
    const resolved=search.exactProduct || search.family?.[0] || null;
    if(resolved && Number(resolved.id)===Number(sample.product_id)){
      verified=sample;
      break;
    }
  }
  assert.ok(verified,"No Mercedes part in sample resolved to the exact product");
  const staffResults=await searchMakatronStaffPrices({
    text:verified.article,staffUserId
  });
  assert.ok(staffResults.length>0,"Staff search returned nothing");
  const staffMessage=staffResults.map(x=>x.text).join("\n");
  assert.match(staffMessage,/Вхідна:/,"Staff private cost line missing");
  assert.match(staffMessage,/Роздріб:/,"Retail line missing");
  const safeQuote=await buildMakatronClientQuote({
    offerId:Number(verified.offer_id),priceGroupId:0,staffUserId
  });
  assert.ok(safeQuote.text.includes(verified.article));
  assert.doesNotMatch(safeQuote.text,/Вхідна:|закуп|собівартість|себестоимость/i);
  const privateCostNumber=Number(verified.unit_cost);
  assert.ok(privateCostNumber>0);
  const recent=await pool.query("SELECT id FROM orders ORDER BY id DESC LIMIT 1");
  if(recent.rowCount){
    const order=await GetManagerOrder.execute(recent.rows[0].id);
    assert.ok(order);
    const message=formatStaffNewOrder(order);
    assert.ok(message.includes("Нове замовлення"),"Order message not formatted");
    assert.ok(message.includes("Разом:"),"Order total missing");
  }
  console.log("SUCCESS: migration 117 present; staff role and pricing matrix verified");
  console.log("SUCCESS: Mercedes offer",verified.article,"private unit cost present in staff mode");
  console.log("SUCCESS: client offer excludes procurement prices");
  console.log("SUCCESS: order formatter read on staging DB (no status changes, no Telegram sends)");
}
try{await check()}catch(error){console.error("STAGING FAILED:",error);process.exitCode=1}
finally{await pool.end()}
