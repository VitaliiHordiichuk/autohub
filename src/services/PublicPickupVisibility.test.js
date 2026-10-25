import test from "node:test";
import assert from "node:assert/strict";
import { WarehouseRepository } from "../repositories/WarehouseRepository.js";
import { listPickupWarehouses } from "../controllers/site-pickup-warehouse.controller.js";
import { renderTelegramOrder, deliveryKeyboard } from "./TelegramOrderView.js";

test("Public pickup query cannot expose OWN warehouses unless explicitly opted in",async()=>{
  let statement="";
  const fakeDb={query:async(sql)=>{
    statement=sql;
    return {rows:[]};
  }};
  const points=await WarehouseRepository.findPickupAvailable(fakeDb);
  assert.deepEqual(points,[]);
  assert.match(statement,/public_pickup_enabled\s*=\s*TRUE/);
  assert.match(statement,/pickup_available\s*=\s*TRUE/);
  assert.match(statement,/public_pickup_name\s+AS\s+name/);
  assert.match(statement,/public_pickup_city\s+AS\s+city/);
  assert.match(statement,/public_pickup_address\s+AS\s+address/);
  assert.doesNotMatch(statement,/OR\s+type\s*=\s*'OWN'/i);
  assert.doesNotMatch(statement,/\bw\.name\b|\bw\.city\b/);
});
test("Old / private pickup ID cannot bypass the public allowlist",async()=>{
  let statement="";
  let params;
  const point=await WarehouseRepository.findPublicPickupById(33,{
    query:async(sql,args)=>{statement=sql;params=args;return {rows:[]};},
  });
  assert.equal(point,null);
  assert.deepEqual(params,[33]);
  assert.match(statement,/public_pickup_enabled\s*=\s*TRUE/);
  assert.match(statement,/\bid\s*=\s*\$1/);
});
test("Telegram pickup keyboard displays public name and address, never internal warehouse",()=>{
  const v=renderTelegramOrder({stage:"PICKUP",sessionKey:"aabbccdd11",
    draft:{options:[{
      id:23,name:"Пункт видачі MAKA",city:"Харків",address:"Тестова адреса 5",
    }]}});
  const btn=v.reply_markup.inline_keyboard[0][0];
  assert.match(btn.text,/Харків.*Пункт видачі MAKA.*Тестова адреса 5/);
  assert.equal(btn.callback_data,"mo:aabbccdd11:warehouse:0");
  assert.doesNotMatch(v.text+btn.text,/Основний склад Mercedes|Наш склад Renault|Паша/);
});
test("No public pickup locations means the customer does not get a pickup button",()=>{
  const keyboard=deliveryKeyboard("aabbccdd11","uk",{pickupAvailable:false});
  assert.ok(keyboard.inline_keyboard.every(row=>row.every(btn=>!btn.callback_data.includes(":pickup"))));
  assert.ok(keyboard.inline_keyboard.some(row=>row.some(btn=>btn.callback_data.includes(":nova"))));
});
test("Site pickup API uses only customer-facing fields",async()=>{
  const original=WarehouseRepository.findPickupAvailable;
  WarehouseRepository.findPickupAvailable=async()=>[{
    id:23,name:"Пункт видачі MAKA",city:"Харків",address:"Тестова адреса 5",
    delivery_days:0,
  }];
  const output={};
  try {
    await listPickupWarehouses(null,{json:x=>{Object.assign(output,x);return x;}});
    assert.equal(output.success,true);
    assert.equal(output.warehouses.length,1);
    assert.deepEqual(output.warehouses[0],{
      id:23,name:"Пункт видачі MAKA",city:"Харків",address:"Тестова адреса 5",
      deliveryDays:0,
    });
    assert.equal(output.warehouses[0].type,undefined);
  } finally {
    WarehouseRepository.findPickupAvailable=original;
  }
});
