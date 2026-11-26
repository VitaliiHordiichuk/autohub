// Explicit opt-in: this test uses a local isolated PostgreSQL, never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageSpecialOrderTxt} from './SpecialOrderStageImportService.js';
import {activateMercedesTxtRevision} from './SpecialOrderAdminRevisionService.js';
import {hashTxtSourceFileAt} from './SpecialOrderTxtSourceIntegrityService.js';
import {removeReplacedTxtAt} from './SpecialOrderTxtAdminWorkflowService.js';
import {readSpecialOrderPublicOffer} from './SpecialOrderPublicSearchService.js';
function line(article,price,group='18'){const chars=Array(215).fill(' ');for(const [at,text] of [[21,article],[42,'TEST PART'],[102,'00'],[106,group],[196,price]])for(let i=0;i<text.length;i++)chars[at+i]=text[i];return chars.join('');}
const oldId='883092b1-e6c1-46cb-b5b3-476f4969ebe6',newId='6ed79a21-dc1b-4359-91b1-8d021b75521f';
test('isolated PostgreSQL: stage, preserve active prices, apply, delete only old TXT; failure preserves active version', {skip:process.env.MAKA_TXT_LOCAL_INTEGRATION!=='true'}, async()=>{
 const db=new pg.Client({host:'/private/tmp/maka-vin-telegram-20261124/pg-socket',port:55439,user:'maka_vin_test',database:'postgres'});
 const dir=await mkdtemp(join(tmpdir(),'txt-db-workflow-'));
 const original=process.env.MAKA_TXT_ACTIVATION_ENABLED;
 await db.connect();let schema=false;
 try{
  const identity=await db.query('SELECT current_database() AS db,current_user AS usr,current_setting(\'port\') AS port');assert.deepEqual(identity.rows[0],{db:'postgres',usr:'maka_vin_test',port:'55439'});
  await db.query('CREATE SCHEMA maka_txt_admin_workflow_test');schema=true;await db.query('SET search_path TO maka_txt_admin_workflow_test');
  await db.query(`CREATE TABLE special_order_import_runs(id BIGSERIAL PRIMARY KEY,source_key VARCHAR NOT NULL,status VARCHAR NOT NULL DEFAULT 'IMPORTING',total_lines BIGINT NOT NULL DEFAULT 0,eligible_lines BIGINT NOT NULL DEFAULT 0,rejected_lines BIGINT NOT NULL DEFAULT 0,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),finished_at TIMESTAMPTZ,upload_file_id UUID UNIQUE,source_sha256 VARCHAR(64));CREATE TABLE special_order_sources(source_key VARCHAR PRIMARY KEY,active_import_id BIGINT REFERENCES special_order_import_runs);CREATE TABLE special_order_entries(import_id BIGINT NOT NULL REFERENCES special_order_import_runs,line_number BIGINT NOT NULL,article VARCHAR NOT NULL,article_normalized VARCHAR NOT NULL,title TEXT,discount_group VARCHAR NOT NULL,retail_ex_vat_uah NUMERIC NOT NULL,PRIMARY KEY(import_id,line_number));`);
  const jobs=new Map();
  async function stage(fileId,text,expected){const data=Buffer.from(text);const sha=createHash('sha256').update(data).digest('hex');const filename=join(dir,`${fileId}.txt`);await writeFile(filename,data,{mode:0o600});await writeFile(filename+'.json',JSON.stringify({fileId,sourceKey:'mercedes-txt',sha256:sha,sizeBytes:data.length}),{mode:0o600});const result=await stageSpecialOrderTxt({client:db,filename,uploadFileId:fileId,expectedSha256:sha,...expected});jobs.set(fileId,{fileId,sourceKey:'mercedes-txt',status:'READY_NOT_ACTIVATED',imported:true,activated:false,importId:result.importId,sha256:sha,...expected});return result;}
  const first=await stage(oldId,line('A1234567890','100.00')+'\n',{expectedLines:1,expectedAccepted:1,expectedUniqueArticles:1,expectedPricingConflicts:0});
  await db.query("INSERT INTO special_order_sources VALUES('mercedes-txt',$1)",[first.importId]);
  const second=await stage(newId,[line('A1234567890','200.00'),line('A1111111111','20.00'),line('A1111111111','30.00'),'invalid line'].join('\n')+'\n',{expectedLines:4,expectedAccepted:3,expectedUniqueArticles:2,expectedPricingConflicts:1});
  assert.equal((await db.query("SELECT active_import_id FROM special_order_sources")).rows[0].active_import_id,String(first.importId));await lstat(join(dir,`${oldId}.txt`));
  const offer=()=>readSpecialOrderPublicOffer({article:'1234567890',pricingContext:{priceGroupName:'Guest'},enabled:true},{db});const previousPrice=(await offer()).indicativePriceUah;
  process.env.MAKA_TXT_ACTIVATION_ENABLED='true';
  const job=jobs.get(newId);const dependencies={db,importId:second.importId,readJob:async()=>job,readClaim:async()=>true,readSourceIntegrity:async(id,sha)=>(await hashTxtSourceFileAt(dir,id))===sha,cleanup:async({db,activeId,previousId})=>{assert.equal((await db.query("SELECT active_import_id FROM special_order_sources")).rows[0].active_import_id,String(activeId));const row=(await db.query('SELECT * FROM special_order_import_runs WHERE id=$1',[previousId])).rows[0];return removeReplacedTxtAt(dir,row,activeId);}};
  await assert.rejects(activateMercedesTxtRevision({...dependencies,readSourceIntegrity:async()=>false}));await lstat(join(dir,`${oldId}.txt`));assert.equal((await offer()).indicativePriceUah,previousPrice);
  const activated=await activateMercedesTxtRevision(dependencies);assert.equal(activated.cleanup.status,'REMOVED');await assert.rejects(lstat(join(dir,`${oldId}.txt`)),{code:'ENOENT'});await lstat(join(dir,`${newId}.txt`));
  assert.equal((await offer()).indicativePriceUah,previousPrice*2);
  assert.equal(await readSpecialOrderPublicOffer({article:'A1111111111',pricingContext:{priceGroupName:'Guest'},enabled:true},{db}),null);
  const badId='7ab79a21-dc1b-4359-91b1-8d021b75521f';await assert.rejects(stage(badId,line('A9999999999','10.00')+'\n',{expectedLines:99,expectedAccepted:1,expectedUniqueArticles:1,expectedPricingConflicts:0}));
  assert.equal((await db.query('SELECT active_import_id FROM special_order_sources')).rows[0].active_import_id,String(second.importId));await lstat(join(dir,`${newId}.txt`));
 }finally{if(original===undefined)delete process.env.MAKA_TXT_ACTIVATION_ENABLED;else process.env.MAKA_TXT_ACTIVATION_ENABLED=original;if(schema)await db.query('DROP SCHEMA maka_txt_admin_workflow_test CASCADE');await db.end();await rm(dir,{recursive:true,force:true});}
});
