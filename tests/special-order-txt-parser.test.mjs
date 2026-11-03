import test from "node:test";
import assert from "node:assert/strict";
import { specialOrderArticle } from "../src/services/SpecialOrderArticlePolicy.js";
import { parseSpecialOrderTxtLine } from "../src/services/SpecialOrderTxtParser.js";

function fixedRow({
  article="A0001530700",
  primaryName="",
  localizedName="",
  firstGroup="20",
  secondGroup="20",
  price="5108,2",
} = {}) {
  const chars = Array(344).fill(" ");
  const place = (at, text) => {
    for (let i = 0; i < text.length; i++) chars[at + i] = text[i];
  };
  place(21, article);
  place(42, primaryName);
  place(72, localizedName);
  place(102, firstGroup);
  place(106, secondGroup);
  place(196, price);
  return chars.join("");
}

test("W-prefix tool is eligible, W-suffix is never eligible", () => {
  assert.equal(specialOrderArticle("W000123456")?.isTool, true);
  assert.equal(specialOrderArticle("w000123456")?.normalized, "W000123456");
  assert.equal(specialOrderArticle("A000123456W"), null);
  assert.equal(specialOrderArticle("W000123456W"), null);
  assert.equal(specialOrderArticle(" A 000 123 456 w "), null);
  assert.equal(specialOrderArticle("A000123W456")?.isTool, false);
});

test("real fixed-width groups: use second group only; first may be empty", () => {
  const both=parseSpecialOrderTxtLine(fixedRow({firstGroup:"18",secondGroup:"20"}));
  assert.equal(both.ok,true);
  assert.equal(both.record.discountGroup,"20");

  const onlySecond=parseSpecialOrderTxtLine(fixedRow({firstGroup:"",secondGroup:"18"}));
  assert.equal(onlySecond.ok,true);
  assert.equal(onlySecond.record.discountGroup,"18");
});

test("evo220 and drt116 must not be reinterpreted as group 20 or 16", () => {
  for (const code of ["evo220","drt116","evo218"]) {
    const line=fixedRow({firstGroup:"",secondGroup:""});
    const patched=line.slice(0,102)+code+line.slice(102+code.length);
    assert.deepEqual(parseSpecialOrderTxtLine(patched),
      {ok:false,reason:"DISCOUNT_GROUP_EXCLUDED"});
  }
});

test("last W is filtered even with an approved discount group", () => {
  for (const article of ["A0001530700W", "w00012345w"]) {
    assert.deepEqual(parseSpecialOrderTxtLine(fixedRow({article})),
      {ok:false,reason:"INVALID_OR_TRAILING_W_ARTICLE"});
  }
  const tool=parseSpecialOrderTxtLine(fixedRow({
    article:"W000123456",secondGroup:"20",localizedName:"Инструмент",
  }));
  assert.equal(tool.ok,true);
  assert.equal(tool.record.isTool,true);
  assert.equal(tool.record.articleNormalized,"W000123456");
  assert.equal(tool.record.discountGroup,"20");
});

test("name from localized column; fallback German name; null if absent", () => {
  assert.equal(parseSpecialOrderTxtLine(fixedRow({
    localizedName:"Датчик тиску наддуву",primaryName:"DRUCKWANDLER"
  })).record.title,"Датчик тиску наддуву");
  assert.equal(parseSpecialOrderTxtLine(fixedRow({
    localizedName:"",primaryName:"DRUCKWANDLER"
  })).record.title,"DRUCKWANDLER");
  assert.equal(parseSpecialOrderTxtLine(fixedRow()).record.title,null);
});

test("price must come from 196 column, not earlier source price", () => {
  const row=fixedRow({price:"437,9"});
  const modified=row.slice(0,153)+"87,58"+row.slice(158);
  const parsed=parseSpecialOrderTxtLine(modified);
  assert.equal(parsed.ok,true);
  assert.equal(parsed.record.retailExVatUah,"437.9");
});

test("bad or incomplete lines are rejected without lookup", () => {
  assert.equal(parseSpecialOrderTxtLine("a000123"), {ok:false,reason:"INVALID_LINE"});
  assert.deepEqual(parseSpecialOrderTxtLine(fixedRow({price:"0"})),
    {ok:false,reason:"INVALID_PRICE"});
});

test("duplicate with spaced terminal W is discarded without hiding normal article", () => {
  const plain = parseSpecialOrderTxtLine(fixedRow({
    article:"A0001112233", secondGroup:"20", price:"1000,00",
  }));
  const suffixed = parseSpecialOrderTxtLine(fixedRow({
    article:"A0001112233    W", secondGroup:"20", price:"1000,00",
  }));
  assert.equal(plain.ok, true);
  assert.equal(plain.record.articleNormalized, "A0001112233");
  assert.deepEqual(suffixed, {
    ok:false, reason:"INVALID_OR_TRAILING_W_ARTICLE",
  });
  assert.equal(specialOrderArticle("a0001112233    W"), null);
});
