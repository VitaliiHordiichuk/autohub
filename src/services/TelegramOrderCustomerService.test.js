import test from "node:test";
import assert from "node:assert/strict";
import {
  getLinkedTelegramRecipient,normalizeTelegramOrderComment,telegramOrderManagerComment,
} from "./TelegramOrderCustomerService.js";
import { renderTelegramOrder } from "./TelegramOrderView.js";

const good={first_name:"Олена",last_name:"Петренко",phone:"+380501234567"};
const verified=async()=>({userId:42});
const fakeDb={query:async(sql,args)=>{
  assert.match(sql,/r\.name='CLIENT'/);
  assert.deepEqual(args,[42]);
  return {rows:[good]};
}};

test("Linked active CLIENT can reuse name and phone without retyping",async()=>{
  const profile=await getLinkedTelegramRecipient({
    chatId:901,telegramUserId:901,expectedUserId:42,
  },{resolveViewer:verified,db:fakeDb});
  assert.deepEqual(profile,{firstName:"Олена",lastName:"Петренко",phone:"+380501234567"});
  const view=renderTelegramOrder({stage:"CONTACT_CONFIRM",draft:{contact:profile},sessionKey:"aabbccdd11"});
  assert.match(view.text,/Олена Петренко/);
  assert.match(view.text,/\+380501234567/);
  assert.deepEqual(view.reply_markup.inline_keyboard.map(row=>row[0].text),
    ["✅ Дані правильні","✏️ Змінити дані","⬅️ До списку"]);
});

test("Telegram profile never resolves without matching UNIQUE account binding",async()=>{
  let queried=false;
  const db={query:async()=>{queried=true;return {rows:[good]};}};
  for(const data of [
    {chatId:901,telegramUserId:901,expectedUserId:null},
    {chatId:901,telegramUserId:902,expectedUserId:42},
    {chatId:901,telegramUserId:901,expectedUserId:43},
  ]) {
    const out=await getLinkedTelegramRecipient(data,{resolveViewer:verified,db});
    assert.equal(out,null);
  }
  assert.equal(queried,false);
});
test("Invalid site phone means manual entry, never a guessed contact",async()=>{
  const profile=await getLinkedTelegramRecipient({
    chatId:901,telegramUserId:901,expectedUserId:42,
  },{resolveViewer:verified,db:{query:async()=>({rows:[{...good,phone:"invalid"}]})}});
  assert.equal(profile,null);
});
test("Optional note trims text, rejects overly long or unsafe notes",()=>{
  assert.equal(normalizeTelegramOrderComment("   "),null);
  assert.equal(normalizeTelegramOrderComment("  Позвоніть перед видачею  "),"Позвоніть перед видачею");
  assert.throws(()=>normalizeTelegramOrderComment("a".repeat(501)),/INVALID_COMMENT/);
  assert.throws(()=>normalizeTelegramOrderComment("x\u0000y"),/INVALID_COMMENT/);
  assert.equal(telegramOrderManagerComment(null),"Замовлення оформлено через Telegram MAKAtron");
  assert.match(telegramOrderManagerComment("Терміново"),
    /Коментарій клієнта: Терміново/);
});
test("Comment screen supports adding a note or skipping without any note",()=>{
  const choice=renderTelegramOrder({stage:"COMMENT_CHOICE",draft:{},sessionKey:"aabbccdd11"});
  assert.match(choice.text,/Коментарій до замовлення \(необов’язково\)/);
  assert.deepEqual(choice.reply_markup.inline_keyboard.map(row=>row[0].callback_data),
    ["mo:aabbccdd11:commentadd","mo:aabbccdd11:commentskip","mo:aabbccdd11:back"]);
  const input=renderTelegramOrder({stage:"COMMENT_INPUT",draft:{},sessionKey:"aabbccdd11"});
  assert.match(input.text,/500 символів/);
  assert.ok(input.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="mo:aabbccdd11:commentskip"));
  const withNote=renderTelegramOrder({stage:"REVIEW",draft:{comment:"Доставка <терміново>"},sessionKey:"aabbccdd11"});
  assert.match(withNote.text,/Доставка &lt;терміново&gt;/);
  assert.doesNotMatch(withNote.text,/<терміново>/);
  assert.ok(withNote.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="mo:aabbccdd11:contactedit"));
});
