import test from "node:test";
import assert from "node:assert/strict";
import { ImportFileParserService } from "./ImportFileParserService.js";
import { parseImportNumber } from "./ImportNumericService.js";
import { parsePrivateUnitCost,assertPrivateCostColumn,parseRowPrivateCost,privateCostEnabled,privateCostSettings } from "./PrivateCostImportService.js";
import { PrivateCostRepository } from "../repositories/PrivateCostRepository.js";

const profile={
  article_column:1,name_column:2,quantity_column:3,price_column:4,
  retail_price_column:5,internal_purchase_price_column:6,start_row:2,
};
test("exact screenshot format A-F parses incoming UNIT cost to six places",async()=>{
 const csv=[
  "Код;Номенклатура;Количество;Цена;Прайсовая цена;Входящая цена",
  "A1679068510;ФАРА ГОЛОВНОГО СВІТЛА;1;123172,70;136858,55;68080,908",
  "A000986727010;*СГ Мовіль;3;2538,83;3297,18;2042,00526",
  "A00098610109;РІДИНА ГАЛЬМІВНА 1Л;105;1124,80;1323,30;911,358634",
 ].join("\n");
 const rows=await ImportFileParserService.parseFileBuffer({
   fileType:"CSV",startRow:2,buffer:Buffer.from(csv),
 });
 assert.equal(rows.length,3);
 assertPrivateCostColumn(rows,profile);
 assert.deepEqual(rows.map((row,i)=>parseRowPrivateCost(row,profile,i+2,row[0])),
  ["68080.908","2042.00526","911.358634"]);
 assert.equal(parseImportNumber(rows[0][3],{fieldName:"цена",article:rows[0][0],rowNumber:2}),123172.7);
 assert.equal(parseImportNumber(rows[0][4],{fieldName:"розница",article:rows[0][0],rowNumber:2}),136858.55);
});
test("5-column old attachment is rejected completely after private F is enabled",()=>{
 const rows=[["A00098610109","Назва",105,"1124,80","1323,30"]];
 assert.throws(()=>assertPrivateCostColumn(rows,profile),/отсутствует реальная входящая цена F/);
 assert.doesNotThrow(()=>assertPrivateCostColumn(rows,{...profile,internal_purchase_price_column:null}));
});
test("Missing, negative, zero, malformed and >6-decimal costs block a full import",()=>{
 for(const cost of ["","-5","0","1,2345678","none","1.000,25","1e5",null]){
   assert.throws(()=>assertPrivateCostColumn([
      ["A00098610109","Назва",105,"1124,80","1323,30",cost],
   ],profile));
 }
 assert.equal(parsePrivateUnitCost("0,000001"),"0.000001");
 assert.equal(parsePrivateUnitCost("68080,908"),"68080.908");
});
test("Private cost uses only isolated table with decimal strings, not price calculations",async()=>{
 const queries=[];
 const db={query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}};
 await PrivateCostRepository.upsert(1112,"911.358634",db);
 assert.equal(queries.length,1);
 assert.match(queries[0].sql,/INSERT INTO product_offer_internal_costs/);
 assert.doesNotMatch(queries[0].sql,/UPDATE product_offers/);
 assert.deepEqual(queries[0].params,[1112,"911.358634"]);
});

test("Verified OWN warehouse-1 XLSX requires column F for MANUAL and EMAIL",()=>{
 const enabled={...profile,warehouse_id:1,warehouse_type:"OWN",supplier_type:"OWN",pricing_model:"OWN_DUAL_PRICE"};
 assert.equal(privateCostEnabled(enabled,{fileType:"XLSX",importMethod:"MANUAL"}),true);
 assert.equal(privateCostEnabled(enabled,{fileType:"XLSX",importMethod:"EMAIL"}),true);
 assert.equal(privateCostEnabled({...enabled,internal_purchase_price_column:null},
   {fileType:"XLSX",importMethod:"MANUAL"}),true);
 assert.equal(privateCostSettings({...enabled,internal_purchase_price_column:null},
   {fileType:"XLSX",importMethod:"MANUAL"}).internal_purchase_price_column,6);
 for(const context of [
   {fileType:"CSV",importMethod:"EMAIL"},
   {fileType:"CSV",importMethod:"MANUAL"},
 ]){
   assert.equal(privateCostEnabled(enabled,context),false);
   assert.equal(privateCostSettings(enabled,context).internal_purchase_price_column,null);
 }
 assert.equal(privateCostEnabled({...enabled,warehouse_id:2},{fileType:"XLSX",importMethod:"MANUAL"}),false);
 assert.equal(privateCostEnabled({...enabled,warehouse_type:"SUPPLIER"},{fileType:"XLSX",importMethod:"EMAIL"}),false);
 assert.equal(privateCostEnabled({...enabled,supplier_type:"PARTNER"},{fileType:"XLSX",importMethod:"EMAIL"}),false);
 assert.equal(privateCostEnabled({...enabled,pricing_model:"SUPPLIER_MARKUP"},{fileType:"XLSX",importMethod:"EMAIL"}),false);
 assert.throws(()=>privateCostSettings({...enabled,internal_purchase_price_column:5},
   {fileType:"XLSX",importMethod:"EMAIL"}),/только колонка F/);
});
test("Excel XLSX with numeric comma-formatted columns retains sixth column as decimal",async()=>{
 const XLSX=await import("xlsx");
 const book=XLSX.utils.book_new();
 const rows=[
 ["Код","Номенклатура","Количество","Цена","Прайсовая цена","Входящая цена"],
 ["A1679068510","ФАРА ГОЛОВНОГО СВІТЛА",1,123172.70,136858.55,68080.908],
 ["A00098610109","РІДИНА ГАЛЬМІВНА 1Л",105,1124.80,1323.30,911.358634],
 ];
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),"Прайс");
 const parsed=await ImportFileParserService.parseFileBuffer({
   buffer:Buffer.from(XLSX.write(book,{type:"buffer",bookType:"xlsx"})),
   fileType:"XLSX",startRow:2,
 });
 assert.equal(parsed.length,2);
 assertPrivateCostColumn(parsed,profile);
 assert.deepEqual(parsed.map((row,i)=>parseRowPrivateCost(row,profile,i+2,row[0])),
   ["68080.908","911.358634"]);
});
