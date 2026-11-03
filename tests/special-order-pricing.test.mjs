import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSpecialOrderPrice,
  specialOrderAllowedGroups,
  specialOrderDiscountGroup,
} from "../src/services/SpecialOrderPricingService.js";

const calculate = (group, price, priceGroupName = "Guest") =>
  calculateSpecialOrderPrice({
    secondDiscountGroup: group,
    retailPriceExVatUah: price,
    priceGroupName,
  });

test("all explicitly approved groups only", () => {
  const approved = ["00","03","05","08","081","082","083","08s","081s","082s","083s","09",
    "10","13","13s","16","16s","17","18","20","20s","23","26","28","30","30s","32",
    "35","38","38s","40","40s","43","46","50","52","54",
    ...Array.from({length:18},(_,i)=>String(i+55))];
  assert.deepEqual(new Set(specialOrderAllowedGroups()), new Set(approved));
  assert.equal(specialOrderDiscountGroup(" 20s "), "20s");
  assert.equal(specialOrderDiscountGroup("20S"), "20s");
});

test("unknown codes with embedded numbers are always rejected", () => {
  for (const group of ["drt116","evo220","drt1116","evo18","116","220","20 x","20-s",
    "74","00X","200","20.0","30ss","  2 0 ", "", "55abc", "000"]) {
    assert.equal(specialOrderDiscountGroup(group), null, group);
    assert.equal(calculate(group, "1000"), null, group);
  }
});

test("UAH 11692,15 group 20 guest and GOLD/VIP prices after VAT", () => {
  assert.deepEqual(calculate("20","11692,15"), {
    articlePriceUah: 13188.75, discountGroup:"20",discountPercent:6,
    customerTier:"standard",currency:"UAH"
  });
  for (const tier of ["GOLD","VIP","gold"," vip "]) {
    assert.equal(calculate("20","11692.15",tier)?.articlePriceUah,10522.94);
  }
  assert.equal(calculate("20","11692,15","Registered")?.articlePriceUah,13188.75);
});

test("00, low and high discount bands", () => {
  const cases = [
    ["00", 1200,1200], ["03",1188,1140], ["081s",1188,1140],
    ["32",1128,900],["38s",1128,900],["55",1176,1116],["72",1176,1116]
  ];
  for (const [group,standard,premium] of cases) {
    assert.equal(calculate(group, "1000","Guest")?.articlePriceUah, standard,group);
    assert.equal(calculate(group, "1000","GOLD")?.articlePriceUah, premium,group);
  }
});

test("round at the very end, including 3-4 fractional input digits", () => {
  assert.equal(calculate("00","0.0042")?.articlePriceUah,0.01);
  assert.equal(calculate("00","0.0041"), null);
  assert.equal(calculate("20","1000.0050")?.articlePriceUah,1128.01);
});

test("invalid prices are not offered", () => {
  for (const value of ["",null,undefined,"0","-1","NaN","1 000,25","1,2,3","1.23456","abc"]) {
    assert.equal(calculate("20",value),null,String(value));
  }
});
