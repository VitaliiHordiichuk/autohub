import { createHash } from 'node:crypto';
import { pool } from '../config/db.js';
import { transaction } from './ProductImageLifecycle.js';
import { ProductPublicUpdateService } from './ProductPublicUpdateService.js';
import { analyzeDisplayFraming, bindDisplayFraming, currentDisplayFraming, framingEnabled, normalizeDisplayCrop, originalDisplayFraming, DISPLAY_FRAMING_VERSION, sameImageComposition, brandingStamp } from './ProductImageFraming.js';

const fault = (message,status=400) => Object.assign(new Error(message),{status});
const id = value => { const n=Number(value); if(!Number.isSafeInteger(n)||n<=0)throw fault('Invalid image identifier'); return n; };
export const displayFrameRevision = row => createHash('sha256').update(JSON.stringify([row.url,row.storage_key,row.processing_request_id,row.image_display_frame])).digest('hex');
async function readObject(key) { const {createProductImageStorage}=await import('./ProductImageService.js');return createProductImageStorage().read(key); }
async function find(productId,imageId,db) {
  const {rows}=await db.query('SELECT pi.*,p.article FROM product_images pi JOIN products p ON p.id=pi.product_id WHERE pi.id=$1 AND pi.product_id=$2',[id(imageId),id(productId)]);
  if(!rows[0])throw fault('Photo not found',404);
  return rows[0];
}
export async function analyzeImageRow(row,read=readObject) {
  const processed=row.display_mode==='PROCESSED';
  const key=processed?(row.processed_storage_key_800||row.processed_storage_key_400||row.storage_key):row.storage_key;
  if(!key)return originalDisplayFraming(row.processed_width||1500,row.processed_height||1500,'NO_STORAGE_SOURCE');
  try {
    const displayed=await read(key),brandingMode=row.image_branding_mode||'FULL_BRANDED';
    if(processed&&brandingMode==='FULL_BRANDED'&&row.merchant_storage_key_1500){
      const clean=await read(row.merchant_storage_key_1500);
      if(await sameImageComposition(displayed,clean,brandingMode))return analyzeDisplayFraming(clean,{processed:true,cleanSource:true,brandingMode});
    }
    return await analyzeDisplayFraming(displayed,{processed,brandingMode,sourceUrl:row.url,article:row.article});
  }
  catch { return originalDisplayFraming(row.processed_width||1500,row.processed_height||1500,'ANALYSIS_FAILED'); }
}
export async function recoverImageFrame(row,read=readObject) {
  const previous=row.image_display_frame;
  if(['MANUAL','ORIGINAL'].includes(previous?.mode)) {
    const retained=currentDisplayFraming({...row,image_display_frame:{...previous,version:DISPLAY_FRAMING_VERSION}});
    if(retained)return retained;
  }
  return analyzeImageRow(row,read);
}
export async function saveImageFrame(row,frame,db=pool,{conflictIsError=true}={}) {
  const bound=bindDisplayFraming(frame,row);
  const session=typeof db.connect==='function'&&!db.connection?await db.connect():db;
  try { return await transaction(session,async ()=>{
    const result=await session.query(`UPDATE product_images SET image_display_frame=$1::jsonb
      WHERE id=$2 AND product_id=$3 AND url=$4 AND storage_key IS NOT DISTINCT FROM $5
      AND processing_request_id IS NOT DISTINCT FROM $6 AND processing_status <> 'PROCESSING'
      AND image_display_frame IS NOT DISTINCT FROM $7::jsonb RETURNING id`,
    [JSON.stringify(bound),row.id,row.product_id,row.url,row.storage_key,row.processing_request_id,row.image_display_frame==null?null:JSON.stringify(row.image_display_frame)]);
    if(!result.rows.length){if(conflictIsError)throw fault('Photo changed. Reopen the editor.',409);return false;}
    await ProductPublicUpdateService.touch(row.product_id,session);
    return true;
  }); } finally { if(session!==db)session.release(); }
}
export const ProductImageFramingService={
  async get(productId,imageId,db=pool){
    if(!framingEnabled())throw fault('Display framing is disabled',404);
    const row=await find(productId,imageId,db);
    if(row.processing_status==='PROCESSING')throw fault('Photo is being processed. Try again shortly.',409);
    const automatic=await analyzeImageRow(row);
    const framing=currentDisplayFraming(row)||automatic;
    return {framing,automatic,revision:displayFrameRevision(row),url:row.url};
  },
  async save(productId,imageId,settings,db=pool){
    if(!framingEnabled())throw fault('Display framing is disabled',404);
    const row=await find(productId,imageId,db);
    if(settings?.revision!==displayFrameRevision(row))throw fault('Photo changed. Reopen the editor.',409);
    if(row.processing_status==='PROCESSING')throw fault('Photo is being processed. Try again shortly.',409);
    const mode=settings?.mode;
    if(!['AUTO','MANUAL','ORIGINAL'].includes(mode))throw fault('Invalid framing mode');
    let frame=await analyzeImageRow(row);
    if(mode==='MANUAL'){
      const crop=normalizeDisplayCrop(settings.crop);if(!crop)throw fault('Invalid crop');
      frame={...frame,mode,status:'READY',reason:null,crop,stamp:frame.stamp||(row.display_mode==='PROCESSED'&&row.image_branding_mode!=='CLEAN'?brandingStamp(frame.imageWidth,frame.imageHeight):null)};
    } else if(mode==='ORIGINAL') frame={...originalDisplayFraming(frame.imageWidth,frame.imageHeight),mode};
    await saveImageFrame(row,frame,db);
    return {framing:frame};
  },
  async recover({limit=2,cursor=0,dryRun=false,db=pool,read=readObject}={}){
    if(!framingEnabled())return [];
    const result=await db.query(`SELECT pi.*,p.article FROM product_images pi JOIN products p ON p.id=pi.product_id
      WHERE pi.id>$1 AND pi.processing_status <> 'PROCESSING' AND (
        pi.image_display_frame IS NULL OR pi.image_display_frame->>'version' IS DISTINCT FROM '2' OR pi.image_display_frame->>'sourceUrl' IS DISTINCT FROM pi.url
        OR pi.image_display_frame->>'sourceKey' IS DISTINCT FROM pi.storage_key
        OR pi.image_display_frame->>'sourceRequest' IS DISTINCT FROM COALESCE(pi.processing_request_id,0)::text
      ) ORDER BY pi.id LIMIT $2`,[Math.max(0,Number(cursor)||0),Math.min(100,Math.max(1,Number(limit)||2))]);
    const results=[];
    for(const row of result.rows){
      const frame=await recoverImageFrame(row,read);
      const saved=dryRun?false:await saveImageFrame(row,frame,db,{conflictIsError:false});
      results.push({id:row.id,article:row.article,status:frame.status,reason:frame.reason,framing:frame,saved});
    }
    return results;
  },
};
