import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pool} from '../config/db.js';
import {ProductImageFramingService,saveImageFrame,displayFrameRevision} from './ProductImageFramingService.js';
import {originalDisplayFraming,bindDisplayFraming} from './ProductImageFraming.js';
import {PublicProductImageService} from './PublicProductImageService.js';
let db;
const old=process.env.PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED;
before(async()=>{
 assert.ok(process.env.NODE_ENV==='test'&&/_test$/.test(process.env.DB_NAME||'')&&['localhost','127.0.0.1','::1'].includes(process.env.DB_HOST));
 db=await pool.connect();
 await db.query(`CREATE TEMP TABLE products(id int PRIMARY KEY,article text,updated_at timestamptz);CREATE TEMP TABLE schema_migrations(version text PRIMARY KEY);
 CREATE TEMP TABLE product_images(id int PRIMARY KEY,product_id int,url text,storage_key text,processing_request_id int,processing_status text,display_mode text,image_branding_mode text,
 processed_url_400 text,processed_url_800 text,processed_url_1200 text,processed_url_1600 text,processed_storage_key_400 text,processed_storage_key_800 text);
 INSERT INTO products VALUES(1,'A123',NOW());INSERT INTO product_images(id,product_id,url,storage_key,processing_request_id,processing_status,display_mode,image_branding_mode) VALUES(1,1,'https://example.test/unchanged.webp','unchanged/key',3,'PROCESSED','PROCESSED','CLEAN');`);
 await db.query(await fs.readFile(new URL('../../migrations/134_product_image_display_framing.sql',import.meta.url),'utf8'));
 process.env.PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED='true';
});
after(async()=>{if(old===undefined)delete process.env.PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED;else process.env.PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED=old;db?.release();await pool.end();});
const row=async()=> (await db.query('SELECT * FROM product_images WHERE id=1')).rows[0];
test('migration is idempotent; metadata changes preserve every source field',async()=>{
 await db.query(await fs.readFile(new URL('../../migrations/134_product_image_display_framing.sql',import.meta.url),'utf8'));
 const before=await row();await saveImageFrame(before,{...originalDisplayFraming(),mode:'MANUAL',crop:{left:.2,top:.2,width:.6,height:.6}},db);
 const after=await row();delete before.image_display_frame;delete after.image_display_frame;assert.deepEqual(after,before);
});
test('stale admin edit cannot overwrite a newer manual edit',async()=>{
 const before=await row();await saveImageFrame(before,{...originalDisplayFraming(),mode:'ORIGINAL'},db);
 await assert.rejects(saveImageFrame(before,originalDisplayFraming(),db),e=>e.status===409);
 assert.equal((await row()).image_display_frame.mode,'ORIGINAL');
});
test('processing generation changes reject a slow analysis',async()=>{
 const before=await row();await db.query('UPDATE product_images SET processing_request_id=processing_request_id+1 WHERE id=1');
 assert.equal(await saveImageFrame(before,originalDisplayFraming(),db,{conflictIsError:false}),false);
});
test('public SQL suppresses stale metadata and private keys',async()=>{
 let image=(await db.query(`SELECT ${PublicProductImageService.sql()} AS image FROM product_images pi WHERE id=1`)).rows[0].image;
 assert.equal(image.framing,null);
 const before=await row();await saveImageFrame(before,originalDisplayFraming(),db);
 image=(await db.query(`SELECT ${PublicProductImageService.sql()} AS image FROM product_images pi WHERE id=1`)).rows[0].image;
 assert.equal(image.url,'https://example.test/unchanged.webp');assert.equal(image.framing.sourceKey,undefined);assert.equal(image.framing.version,1);
});
test('manual edits validate revision and crop before any write',async()=>{
 const before=await row();await assert.rejects(ProductImageFramingService.save(1,1,{revision:'stale',mode:'ORIGINAL'},db),e=>e.status===409);
 // Revision is valid but crop is not: avoid storage access by choosing a missing storage source.
 await db.query('UPDATE product_images SET storage_key=NULL WHERE id=1');const current=await row();
 await assert.rejects(ProductImageFramingService.save(1,1,{revision:displayFrameRevision(current),mode:'MANUAL',crop:{left:.9,top:0,width:.2,height:1}},db),/crop/);
 await db.query('UPDATE product_images SET storage_key=$1 WHERE id=1',[before.storage_key]);
});
test('background backfill preserves current manual and review decisions',async()=>{
 const before=await row();await saveImageFrame(before,{...originalDisplayFraming(),mode:'MANUAL'},db);
 let reads=0;assert.deepEqual(await ProductImageFramingService.recover({db,read:async()=>{reads++;throw new Error();}}),[]);assert.equal(reads,0);
});
test('disabling the flag removes schema dependency and admin access',async()=>{
 process.env.PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED='false';assert.doesNotMatch(PublicProductImageService.sql(),/image_display_frame/);
 await assert.rejects(ProductImageFramingService.get(1,1,db),e=>e.status===404);process.env.PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED='true';
});

test('pool writes keep BEGIN, CAS update, public touch and COMMIT on one acquired connection',async()=>{
 let released=0;const before=await row();
 const fakePool={connect:async()=>({query:db.query.bind(db),release(){released++;}}),query(){throw new Error('Pool query must not be used inside transaction');}};
 await saveImageFrame(before,originalDisplayFraming(),fakePool);assert.equal(released,1);
});
