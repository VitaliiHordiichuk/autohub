import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {analyzeDisplayFraming,bindDisplayFraming,currentDisplayFraming,normalizeDisplayCrop,publicDisplayFraming} from './ProductImageFraming.js';
import {PublicProductImageService} from './PublicProductImageService.js';
const image=async shapes=>sharp(Buffer.from(`<svg width="500" height="500"><rect width="500" height="500" fill="white"/>${shapes}</svg>`)).png().toBuffer();
test('white padding is removed without cutting the subject',async()=>{
 const frame=await analyzeDisplayFraming(await image('<rect x="150" y="180" width="200" height="100" fill="black"/>'));
 assert.equal(frame.status,'READY');assert.ok(frame.crop.left<.30&&frame.crop.left>.26);assert.ok(frame.crop.top<.36);assert.ok(frame.crop.left+frame.crop.width>.70);assert.ok(frame.crop.width<.45);
});
test('disconnected fasteners are retained with the main item',async()=>{
 const frame=await analyzeDisplayFraming(await image('<rect x="180" y="180" width="130" height="100" fill="black"/><circle cx="80" cy="340" r="6" fill="black"/>'));
 assert.equal(frame.status,'READY');assert.ok(frame.crop.left<.15);assert.ok(frame.crop.top+frame.crop.height>.69);
});
test('a light item without reliable contrast stays complete',async()=>{
 const frame=await analyzeDisplayFraming(await image('<rect x="150" y="180" width="200" height="100" fill="#eee"/>'));
 assert.equal(frame.status,'REVIEW');assert.deepEqual(frame.crop,{left:0,top:0,width:1,height:1});
});
test('complex backgrounds and edge-touching products are never cut automatically',async()=>{
 const frame=await analyzeDisplayFraming(await image('<rect width="500" height="500" fill="#222"/>'));
 assert.equal(frame.status,'REVIEW');assert.equal(frame.crop.width,1);
});
test('known processed stamp is separate from the object bounds',async()=>{
 const input=await image('<rect x="200" y="180" width="100" height="100" fill="black"/><rect x="320" y="452" width="167" height="35" fill="black"/>');
 const frame=await analyzeDisplayFraming(input,{processed:true,brandingMode:'STAMP_ONLY'});
 assert.equal(frame.status,'READY');assert.ok(frame.crop.width<.25);assert.ok(frame.stamp);
});
test('existing repeating watermark requires review; aligned clean branch is analyzable',async()=>{
 const input=await image('<rect x="200" y="180" width="100" height="100" fill="black"/>');
 assert.equal((await analyzeDisplayFraming(input,{processed:true,brandingMode:'FULL_BRANDED'})).status,'REVIEW');
 assert.equal((await analyzeDisplayFraming(input,{processed:true,brandingMode:'FULL_BRANDED',cleanSource:true})).status,'READY');
});
test('invalid and oversized buffers reject without writing images',async()=>{
 await assert.rejects(analyzeDisplayFraming(Buffer.from('invalid')));await assert.rejects(analyzeDisplayFraming(Buffer.alloc(26*1024*1024)));
});
test('reviewed legacy bounds apply only to matching immutable source and article',async()=>{
 const input=await image('<rect x="200" y="180" width="100" height="100" fill="black"/>');
 const options={processed:true,brandingMode:'STAMP_ONLY',sourceUrl:'/b66961520-photo-670-id.webp',article:'B66961520'};
 assert.equal((await analyzeDisplayFraming(input,options)).reason,'REVIEWED_SOURCE');
 assert.notEqual((await analyzeDisplayFraming(input,{...options,article:'OTHER'})).reason,'REVIEWED_SOURCE');
});
test('frame binds to selected file and generation, public payload has no storage keys',async()=>{
 const frame=await analyzeDisplayFraming(await image('<rect x="200" y="180" width="100" height="100" fill="black"/>'));
 const row={url:'https://example.test/photo.webp',storage_key:'private/key',processing_request_id:7};
 const bound=bindDisplayFraming(frame,row);assert.ok(currentDisplayFraming({...row,image_display_frame:bound}));
 for(const change of [{url:'changed'},{storage_key:'changed'},{processing_request_id:8}])assert.equal(currentDisplayFraming({...row,...change,image_display_frame:bound}),null);
 assert.equal(publicDisplayFraming(bound).sourceKey,undefined);
 const publicImage=PublicProductImageService.normalize({url:row.url,variants:[],framing:bound});
 assert.equal(publicImage.url,row.url);assert.equal(publicImage.framing.sourceKey,undefined);
});
test('invalid normalized crops are rejected',()=>{
 for(const crop of [{left:-.1,top:0,width:1,height:1},{left:.9,top:0,width:.2,height:1},{left:0,top:0,width:NaN,height:1},{left:0,top:0,width:.001,height:1}])assert.equal(normalizeDisplayCrop(crop),null);
});

test('existing clean counterpart is used only after pixel-level composition verification',async()=>{
 const {ProductImageProcessor}=await import('./ProductImageProcessor.js');
 const {sameImageComposition}=await import('./ProductImageFraming.js');
 const input=await image('<rect x="150" y="180" width="200" height="100" fill="#333"/><circle cx="80" cy="340" r="6" fill="black"/>');
 const output=await ProductImageProcessor.process(input,{brandingMode:'FULL_BRANDED',processingMode:'LEGACY'});
 assert.equal(await sameImageComposition(output.variants[800],output.merchant.variant,'FULL_BRANDED'),true);
 const shifted=await sharp(output.merchant.variant).extract({left:150,top:0,width:1350,height:1500}).resize(1500,1500).webp().toBuffer();
 assert.equal(await sameImageComposition(output.variants[800],shifted,'FULL_BRANDED'),false);
});
