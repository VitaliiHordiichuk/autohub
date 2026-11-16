import test from "node:test";
import assert from "node:assert/strict";
import { rotateHomepageFeatures } from "./HomepageFeatureRotation.js";
import { HomepageContentService, homepageDateInKyiv } from "./HomepageContentService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { OfferService } from "./OfferService.js";

const row = (id, fixed = false, type = "NEW") => Object.freeze({
  id, feature_type: type, is_position_fixed: fixed,
  sort_order: id, product_id: id, article: `B0000000${id}`, name: `Product ${id}`,
  discount_percent: null, image_url: "/test-product.jpg", is_active: true,
});
const ids = rows => rows.map(item => item.id);

test("legacy and pinned cards keep the existing order, including tied or sparse order values", () => {
  const rows = Object.freeze([{...row(4),is_position_fixed:undefined,sort_order:0},row(1,true),{...row(2,true),sort_order:100}, {...row(3,true),sort_order:100}]);
  for(const date of ["1970-01-01","2026-11-16","2027-01-01"]) {
    assert.deepEqual(ids(rotateHomepageFeatures(rows,date)),[4,1,2,3]);
  }
});

test("only free slots rotate, every automatic card visits each free slot", () => {
  const rows=Object.freeze([row(1,true),row(2),row(3,true),row(4),row(5)]);
  const seen=new Set();
  for(let day=1;day<=3;day++) {
    const result=rotateHomepageFeatures(rows,`1970-01-0${day}`);
    assert.equal(result[0],rows[0]);assert.equal(result[2],rows[2]);
    seen.add(result[1].id);
    assert.deepEqual(ids(result).sort(),[1,2,3,4,5]);
  }
  assert.deepEqual([...seen],[2,4,5]);
  assert.deepEqual(ids(rows),[1,2,3,4,5]);
});

test("the same day is repeatable and promotion rotation is independent of the collection", () => {
  const rows=[row(1),row(2,false,"PROMOTION"),row(3),row(4,false,"PROMOTION"),row(5)];
  const first=rotateHomepageFeatures(rows,"2026-11-16");
  assert.deepEqual(rotateHomepageFeatures(rows,"2026-11-16"),first);
  const changed=rotateHomepageFeatures([...rows,row(6,false,"PROMOTION")],"2026-11-16");
  assert.deepEqual(ids(changed.filter(r=>r.feature_type==="NEW")),ids(first.filter(r=>r.feature_type==="NEW")));
});

test("empty and single-card groups remain valid", () => {
  assert.deepEqual(rotateHomepageFeatures([],"2026-11-16"),[]);
  const rows=[row(1),row(2,false,"PROMOTION")];
  assert.deepEqual(rotateHomepageFeatures(rows,"2026-11-16"),rows);
});

test("calendar-day rotation crosses Kyiv midnight and DST correctly", () => {
  const rows=[row(1),row(2),row(3)];
  for(const [before,after] of [
    ["2026-11-16T21:59:59Z","2026-11-16T22:00:00Z"],
    ["2026-03-28T21:59:59Z","2026-03-28T22:00:00Z"],
    ["2026-10-24T20:59:59Z","2026-10-24T21:00:00Z"],
  ]) {
    const a=rotateHomepageFeatures(rows,homepageDateInKyiv(before));
    const b=rotateHomepageFeatures(rows,homepageDateInKyiv(after));
    assert.deepEqual(ids(b),[a[1].id,a[2].id,a[0].id]);
  }
});

test("invalid dates fail instead of inventing a rotation", () => {
  for(const date of ["","2026-02-30","2026-11-16T12:00:00Z",null]) {
    assert.throws(()=>rotateHomepageFeatures([row(1)],date),/Некоректна дата/);
  }
});

test("public homepage applies ordering after eligibility and keeps personalized offer data", async t => {
  const rows=[row(1,true),row(2),row(3)];
  t.mock.method(CustomerPricingService,"getContext",async id=>({viewer:id}));
  t.mock.method(OfferService,"getOffersByProductIds",async (ids,context)=>new Map(ids.map(id=>[id,[{
    id:id+100,retailPrice:context.viewer===42?75:100,isAvailable:true,
  }]])));
  const db={async query(sql){
    if(sql.includes("FROM homepage_product_features f")) {
      assert.ok(sql.includes("f.is_active = TRUE")&&sql.includes("p.is_active = TRUE"));
      assert.ok(sql.includes("f.starts_on")&&sql.includes("f.ends_on"));
      return {rows};
    }
    if(sql.includes("INSERT INTO homepage_banner_daily_selections"))return{rows:[{banner_id:null}]};
    return {rows:[]};
  }};
  const guest=await HomepageContentService.getPublic({date:"1970-01-02",userId:null},db);
  const customer=await HomepageContentService.getPublic({date:"1970-01-02",userId:42},db);
  assert.deepEqual(ids(guest.features),[1,3,2]);
  assert.deepEqual(ids(customer.features),[1,3,2]);
  assert.equal(guest.features[0].offer.price,100);
  assert.equal(customer.features[0].offer.price,75);
});
