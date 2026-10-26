import "dotenv/config";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { pool } from "../src/config/db.js";
import { ImportFileParserService } from "../src/services/ImportFileParserService.js";
import { ImportService } from "../src/services/ImportService.js";
import { privateCostSettings,assertPrivateCostColumn,parseRowPrivateCost } from "../src/services/PrivateCostImportService.js";

const database=process.env.DB_NAME||"";
if(!/^autohub_privatecost_stage_[a-zA-Z0-9_]+$/.test(database)) {
 console.error("REFUSED: only a disposable autohub_privatecost_stage_* DB may be used");
 process.exit(2);
}
const cents=(v)=>Number(Number(v).toFixed(2));
async function main() {
 const prof=(await pool.query(
  "SELECT wsi.*,sis.article_column,sis.name_column,sis.quantity_column,"+
  "sis.price_column,sis.retail_price_column,sis.start_row,sis.brand_mode,"+
  "sis.fixed_brand_id,sis.file_type FROM warehouse_supplier_imports wsi "+
  "JOIN supplier_import_settings sis ON sis.id=wsi.supplier_import_settings_id "+
  "WHERE wsi.id=2 AND wsi.warehouse_id=1 AND wsi.is_active=true"
 )).rows[0];
 assert.ok(prof,"Expected Mercedes active import profile 2");
 assert.equal(Number(prof.internal_purchase_price_column),6);
 const selection=(await pool.query(
  "SELECT po.id offer_id,p.article,p.name,po.purchase_price,po.retail_price,"+
  "po.minimum_sale_price,po.quantity,p.brand_id FROM product_offers po "+
  "JOIN products p ON p.id=po.product_id "+
  "WHERE po.warehouse_id=1 AND po.quantity>0 "+
  "AND po.retail_price>po.purchase_price AND po.price_mode='AUTO' "+
  "AND ($1::integer IS NULL OR p.brand_id=$1::integer) "+
  "ORDER BY po.id DESC LIMIT 1",
  [prof.fixed_brand_id??null]
 )).rows[0];
 assert.ok(selection,"No eligible existing Mercedes offer on staging");
 const unitCost="911.358634";
 const data=[
  ["Код","Номенклатура","Количество","Цена","Прайсовая цена","Входящая цена"],
  [selection.article,selection.name,Number(selection.quantity),
   Number(selection.purchase_price),Number(selection.retail_price),Number(unitCost)],
 ];
 const wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),"Склад");
 const parsed=await ImportFileParserService.parseFileBuffer({
  buffer:Buffer.from(XLSX.write(wb,{bookType:"xlsx",type:"buffer"})),
  fileType:"XLSX",startRow:2,
 });
 assert.equal(parsed.length,1);
 const opts=privateCostSettings(prof,{fileType:"XLSX",importMethod:"MANUAL"});
 assertPrivateCostColumn(parsed,opts);
 const row={
  rowNumber:2,rawData:parsed[0],brand:null,
  article:selection.article,name:selection.name,
  quantity:Number(selection.quantity),
  price:Number(selection.purchase_price),
  retailPrice:Number(selection.retail_price),
  internalUnitCost:parseRowPrivateCost(parsed[0],opts,2,selection.article),
 };
 const ctx={warehouseId:1,warehouseSupplierImportId:2,
  fileName:"staging-private-cost.xlsx",fileType:"XLSX",importMethod:"MANUAL"};
 const importResult=await ImportService.importRows(ctx,[row],[]);
 assert.ok(importResult.successRows>=1,JSON.stringify(importResult));
 const after=(await pool.query(
  "SELECT po.purchase_price,po.retail_price,po.minimum_sale_price,ic.unit_cost "+
  "FROM product_offers po JOIN product_offer_internal_costs ic "+
  "ON ic.product_offer_id=po.id WHERE po.id=$1",
  [selection.offer_id]
 )).rows[0];
 assert.ok(after,"Cost was not written on staging");
 assert.equal(after.unit_cost,unitCost);
 for(const col of ["purchase_price","retail_price","minimum_sale_price"]) {
  assert.equal(cents(after[col]),cents(selection[col]),"Pricing unexpectedly changed: "+col);
 }
 console.log("SUCCESS private-cost XLSX: offer",selection.offer_id,
  "cost",after.unit_cost,"existing sale/pricing invariant");

 const noCostOpts=privateCostSettings(prof,{fileType:"CSV",importMethod:"EMAIL"});
 assertPrivateCostColumn([parsed[0].slice(0,5)],noCostOpts);
 const emailCtx={...ctx,fileName:"staging-old-five.csv",
  fileType:"CSV",importMethod:"EMAIL"};
 const oldFive={...row,rawData:row.rawData.slice(0,5)};
 delete oldFive.internalUnitCost;
 const emailResult=await ImportService.importRows(emailCtx,[oldFive],[]);
 assert.ok(emailResult.successRows>=1,JSON.stringify(emailResult));
 const costAgain=(await pool.query(
  "SELECT unit_cost FROM product_offer_internal_costs WHERE product_offer_id=$1",
  [selection.offer_id])).rows[0];
 assert.equal(costAgain.unit_cost,unitCost,
  "Existing auto CSV must never overwrite private incoming cost");
 console.log("SUCCESS old EMAIL/CSV leaves new staff-only unit cost untouched");
 console.log("STAGING ONLY: missing offers may be disabled in this disposable database");
}
try{await main()}catch(e){console.error(e);process.exitCode=1}
finally{await pool.end()}
