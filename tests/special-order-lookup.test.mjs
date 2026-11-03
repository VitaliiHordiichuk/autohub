import test from "node:test";
import assert from "node:assert/strict";
import { lookupSpecialOrderArticle } from "../src/services/SpecialOrderLookupService.js";

test("lookup uses parameterized exact article, approved groups and active READY revision", async () => {
  const calls = [];
  const db = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [
        { article:"A4058819501", title:"", discount_group:"20", retail_ex_vat_uah:"11692.15" },
      ] };
    },
  };
  const rows = await lookupSpecialOrderArticle({
    article:"a 4058819501",
    priceGroupName:"VIP",
    db,
  });
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/s\.active_import_id/);
  assert.match(calls[0].sql,/i\.status = 'READY'/);
  assert.match(calls[0].sql,/e\.article_normalized = \$2/);
  assert.deepEqual(calls[0].parameters.slice(0,2),["mercedes-txt","A4058819501"]);
  assert.ok(calls[0].parameters[2].includes("20"));
  assert.ok(!calls[0].parameters[2].includes("evo220"));
  assert.deepEqual(rows,[{
    article:"A4058819501",name:null,status:"SPECIAL_ORDER_INQUIRY",
    priceUah:10522.94,currency:"UAH",requiresManagerConfirmation:true,
  }]);
});

test("invalid query never hits database", async () => {
  const db = { query(){throw Error("should not query");} };
  assert.deepEqual(await lookupSpecialOrderArticle({article:"!?@",db}),[]);
});

test("unapproved returned groups are omitted even if importer made a mistake", async () => {
  const db = { async query(){return {rows:[
    { article:"A1234567890",title:"Part",discount_group:"evo220",retail_ex_vat_uah:"1000" },
    { article:"A1234567890",title:"Part",discount_group:"32",retail_ex_vat_uah:"1000" },
  ]};} };
  const result = await lookupSpecialOrderArticle({article:"A1234567890",db});
  assert.equal(result.length,1);
  assert.equal(result[0].priceUah,1128);
  assert.equal(result[0].name,"Part");
});

test("lookup never queries a terminal-W article; W-prefix tools are searchable", async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push(params);
      return { rows: [] };
    }
  };
  for (const article of ["A000123456W","W123456W","a000123456w"]) {
    assert.deepEqual(await lookupSpecialOrderArticle({article, db}), [], article);
  }
  assert.equal(queries.length, 0);
  assert.deepEqual(await lookupSpecialOrderArticle({article:"W000123456", db}), []);
  assert.equal(queries.length, 1);
  assert.equal(queries[0][1],"W000123456");
});
