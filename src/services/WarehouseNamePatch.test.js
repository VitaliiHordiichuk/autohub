import test from "node:test";
import assert from "node:assert/strict";
import {WarehouseService} from "./WarehouseService.js";
import {WarehouseRepository} from "../repositories/WarehouseRepository.js";
import {SupplierRepository} from "../repositories/SupplierRepository.js";

test("rename preserves warehouse identity, pricing and stock even for an inactive supplier",async t=>{
 const current={id:4,name:"Паша",city:"Харків",type:"SUPPLIER",supplier_id:9,
  pricing_model:"SUPPLIER_MARKUP",retail_markup_percent:25,minimum_markup_percent:10,
  priority:3,is_active:false,offers_count:123,return_policy_override:"INHERIT"};
 t.mock.method(WarehouseRepository,"findById",async id=>{assert.equal(id,4);return current;});
 t.mock.method(SupplierRepository,"findById",async()=>{throw Error("Rename must not revalidate supplier");});
 let changes;
 t.mock.method(WarehouseRepository,"update",async(id,fields)=>{assert.equal(id,4);changes=fields;return {...current,...fields};});
 const updated=await WarehouseService.updateWarehouse("4",{name:"  Склад партнера  "});
 assert.deepEqual(changes,{name:"Склад партнера"});
 for(const key of Object.keys(current))assert.equal(updated[key],key==="name"?"Склад партнера":current[key]);
});
test("rename validates names and missing warehouses before writing",async t=>{
 t.mock.method(WarehouseRepository,"findById",async()=>({id:4,name:"Паша"}));
 t.mock.method(WarehouseRepository,"update",async()=>{throw Error("Invalid rename cannot write");});
 for(const name of ["", "   ",null,"a".repeat(151)])
  await assert.rejects(WarehouseService.updateWarehouse(4,{name}),/Название склада/);
 await assert.rejects(WarehouseService.updateWarehouse(0,{name:"Склад"}),/Некорректный номер/);
 WarehouseRepository.findById.mock.restore();
 t.mock.method(WarehouseRepository,"findById",async()=>null);
 await assert.rejects(WarehouseService.updateWarehouse(4,{name:"Склад"}),/Склад не найден/);
});
test("repository rename changes only name and timestamp, retaining all settings",async()=>{
 let parameters;
 await WarehouseRepository.update(4,{name:"Партнер"},{query:async(sql,args)=>{
  assert.match(sql,/UPDATE warehouses/);assert.doesNotMatch(sql,/UPDATE product_offers/);
  parameters=args;return {rows:[{id:4,name:"Партнер"}]};
 }});
 assert.equal(parameters[0],4);assert.equal(parameters[4],"Партнер");
 for(const index of [2,5,11,17])assert.equal(parameters[index],false);
 for(const index of [1,7,8,9,10,13,14,15,16])assert.equal(parameters[index],undefined);
});
