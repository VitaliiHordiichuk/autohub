import sharp from 'sharp';

export const DISPLAY_FRAMING_VERSION = 2;
export const framingEnabled = () => process.env.PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED === 'true';
const full = () => ({left:0,top:0,width:1,height:1});
const reviewed = {
  '-photo-670-':[18,70,364,260], '-photo-654-':[12,96,376,222], '-photo-665-':[12,94,376,224],
  '-photo-48-':[132,90,136,220], '-photo-40-':[151,86,98,230], '-photo-673-':[18,103,364,220],
  '-photo-680-':[24,18,352,332], '-photo-38-':[60,92,280,218], '-photo-659-':[12,72,376,263], '-photo-652-':[20,100,368,225],
};
// Keys additionally bind the reviewed windows to their original product.
const reviewedArticles = {'-photo-670-':'B66961520','-photo-654-':'B66961524','-photo-665-':'B66961526','-photo-48-':'B67960045','-photo-40-':'B66959846','-photo-673-':'B66961522','-photo-680-':'B66961525','-photo-38-':'B66959344','-photo-659-':'B66961521','-photo-652-':'B66040686'};
export function normalizeDisplayCrop(value) {
  if (!value || typeof value !== 'object') return null;
  const crop=Object.fromEntries(['left','top','width','height'].map(k=>[k,Number(value[k])]));
  if(Object.values(crop).some(v=>!Number.isFinite(v))||crop.left<0||crop.top<0||crop.width<.02||crop.height<.02||crop.left+crop.width>1.000001||crop.top+crop.height>1.000001)return null;
  return crop;
}
export function publicDisplayFraming(value) {
  if(!value||value.version!==DISPLAY_FRAMING_VERSION||!['AUTO','MANUAL','ORIGINAL'].includes(value.mode)||!['READY','REVIEW'].includes(value.status))return null;
  const crop=normalizeDisplayCrop(value.crop),width=Number(value.imageWidth),height=Number(value.imageHeight);
  if(!crop||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>100000||height>100000)return null;
  return {version:2,mode:value.mode,status:value.status,reason:typeof value.reason==='string'?value.reason.slice(0,64):null,imageWidth:width,imageHeight:height,crop,stamp:normalizeDisplayCrop(value.stamp)};
}
export function bindDisplayFraming(frame,row) {
  return {...frame,sourceUrl:row.url,sourceKey:row.storage_key??null,sourceRequest:String(row.processing_request_id??0),updatedAt:new Date().toISOString()};
}
export function currentDisplayFraming(row) {
  const value=row.image_display_frame;
  return value?.sourceUrl===row.url&&(value.sourceKey??null)===(row.storage_key??null)&&String(value.sourceRequest)===String(row.processing_request_id??0)?publicDisplayFraming(value):null;
}
export function brandingStamp(width,height) {
  if(Math.abs(width-height)/Math.max(width,height)>.005)return null;
  // Existing processing uses a 500x103 stamp on a 1500px canvas, inset38px.
  return {left:962/1500,top:1359/1500,width:500/1500,height:103/1500};
}
export function originalDisplayFraming(width=1500,height=1500,reason=null) {
  return {version:2,mode:'AUTO',status:reason?'REVIEW':'READY',reason,imageWidth:width,imageHeight:height,crop:full(),stamp:null};
}

/** Read-only analysis: never encodes/publishes an image, changes a key or invents detail. */
export async function analyzeDisplayFraming(input,{brandingMode='CLEAN',processed=false,cleanSource=false,sourceUrl='',article=''}={}) {
  if(!Buffer.isBuffer(input)||!input.length||input.length>25*1024*1024)throw new Error('Invalid framing image');
  const metadata=await sharp(input,{limitInputPixels:80_000_000,failOn:'warning'}).metadata();
  const rotated=Number(metadata.orientation)>=5&&Number(metadata.orientation)<=8;
  const width=rotated?metadata.height:metadata.width,height=rotated?metadata.width:metadata.height;
  if(!width||!height)throw new Error('Missing image dimensions');
  const fallback=reason=>originalDisplayFraming(width,height,reason);
  if(metadata.pages>1)return fallback('ANIMATED_IMAGE');
  const stamp=processed&&brandingMode!=='CLEAN'?brandingStamp(width,height):null;
  const known=Object.entries(reviewed).find(([key])=>sourceUrl.includes(key)&&article===reviewedArticles[key]);
  if(known&&processed){const [x,y,w,h]=known[1];return {version:2,mode:'AUTO',status:'READY',reason:'REVIEWED_SOURCE',imageWidth:width,imageHeight:height,crop:{left:x/400,top:y/400,width:w/400,height:h/400},stamp};}
  // A repeating watermark can resemble a separate pale component. Analyse a
  // clean, identically aligned branch for new uploads; preserve older ambiguous
  // full-branded photos until an administrator explicitly chooses the bounds.
  if(processed&&brandingMode==='FULL_BRANDED'&&!cleanSource)return fallback('REPEATING_WATERMARK');
  const {data,info}=await sharp(input,{limitInputPixels:80_000_000,failOn:'warning'}).rotate().flatten({background:'#fff'}).toColorspace('srgb').resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const W=info.width,H=info.height,C=info.channels,mask=new Uint8Array(W*H),strong=new Uint8Array(W*H);
  const excluded=(x,y)=>Boolean(stamp&&!cleanSource&&x/W>=.60&&y/H>=.88);
  let border=0,whiteBorder=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const n=y*W+x,i=n*C,r=data[i],g=data[i+1],b=data[i+2],lo=Math.min(r,g,b),hi=Math.max(r,g,b);
    if(excluded(x,y))continue;
    const weak=255-lo>=22||(hi-lo>=18&&lo<245);
    mask[n]=weak?1:0;strong[n]=lo<160||(hi-lo>=65&&lo<235)?1:0;
    if(x<3||y<3||x>=W-3||y>=H-3){border++;if(!weak)whiteBorder++;}
  }
  if(whiteBorder/Math.max(1,border)<.96)return fallback('COMPLEX_BACKGROUND');
  const visited=new Uint8Array(W*H),queue=new Int32Array(W*H),components=[];
  for(let start=0;start<mask.length;start++){
    if(!mask[start]||visited[start])continue;
    let head=0,tail=0,minX=W,minY=H,maxX=0,maxY=0,strongCount=0;queue[tail++]=start;visited[start]=1;
    while(head<tail){const n=queue[head++],x=n%W,y=Math.floor(n/W);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);strongCount+=strong[n];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const next=ny*W+nx;if(mask[next]&&!visited[next]){visited[next]=1;queue[tail++]=next;}}
    }
    if(tail>=8||(tail>=2&&strongCount)||strongCount>=2)components.push({minX,minY,maxX,maxY,area:tail,strong:strongCount});
  }
  if(!components.length||!components.some(c=>c.strong>=3))return fallback('LOW_CONTRAST');
  const left=Math.min(...components.map(c=>c.minX)),top=Math.min(...components.map(c=>c.minY)),right=Math.max(...components.map(c=>c.maxX)),bottom=Math.max(...components.map(c=>c.maxY));
  if(left<=1||top<=1||right>=W-2||bottom>=H-2)return fallback('TOUCHES_EDGE');
  // Never silently crop a component that may extend underneath the known stamp.
  if(stamp&&!cleanSource&&right>=W*.59&&bottom>=H*.87)return fallback('NEAR_BRANDING');
  const w=right-left+1,h=bottom-top+1;
  if(w<10||h<10||w*h/(W*H)<.006)return fallback('SUBJECT_TOO_SMALL');
  // A dark label must never be mistaken for an entire white/translucent part.
  // A substantial faint silhouette outside the confident box makes the crop
  // uncertain; preserve the full image rather than zooming into the label.
  const halo=Math.max(6,Math.ceil(Math.max(w,h)*.06));let paleOutside=0;
  for(let py=0;py<H;py++)for(let px=0;px<W;px++){
    if(excluded(px,py)||(px>=left-halo&&px<=right+halo&&py>=top-halo&&py<=bottom+halo))continue;
    const i=(py*W+px)*C,lo=Math.min(data[i],data[i+1],data[i+2]);
    if(lo>=234&&lo<=249)paleOutside++;
  }
  if(paleOutside>Math.max(30,w*h*.025))return fallback('FAINT_OUTER_CONTENT');
  const padding=Math.max(4,Math.ceil(Math.max(w,h)*.025));
  const x=Math.max(0,left-padding),y=Math.max(0,top-padding),r=Math.min(W,right+1+padding),b=Math.min(H,bottom+1+padding);
  return {version:2,mode:'AUTO',status:'READY',reason:null,imageWidth:width,imageHeight:height,crop:{left:x/W,top:y/H,width:(r-x)/W,height:(b-y)/H},stamp};
}

const overlayCache=new Map();
export async function sameImageComposition(siteInput,cleanInput,brandingMode) {
  const size=256;
  const [siteMeta,cleanMeta]=await Promise.all([sharp(siteInput).metadata(),sharp(cleanInput).metadata()]);
  if(!siteMeta.width||!siteMeta.height||!cleanMeta.width||!cleanMeta.height||Math.abs(siteMeta.width/siteMeta.height-cleanMeta.width/cleanMeta.height)>.005)return false;
  if(!overlayCache.has(brandingMode))overlayCache.set(brandingMode,(async()=>{
    const {productImageBrandingOverlay}=await import('./ProductImageProcessor.js');
    return productImageBrandingOverlay(brandingMode,size);
  })());
  const raw=async input=>sharp(input,{limitInputPixels:80_000_000,failOn:'warning'}).rotate().flatten({background:'#fff'}).toColorspace('srgb').resize(size,size,{fit:'fill'}).removeAlpha().raw().toBuffer();
  const [site,clean,overlay]=await Promise.all([raw(siteInput),raw(cleanInput),overlayCache.get(brandingMode)]);
  let error=0,bad=0,foreground=0,foregroundBad=0;
  for(let n=0;n<size*size;n++){
    const i=n*3,j=n*4,alpha=overlay[j+3]/255;
    const difference=Math.max(...[0,1,2].map(c=>Math.abs(site[i+c]-(clean[i+c]*(1-alpha)+overlay[j+c]*alpha))));
    error+=difference;if(difference>24)bad++;
    if(Math.min(clean[i],clean[i+1],clean[i+2])<200){foreground++;if(difference>24)foregroundBad++;}
  }
  // A nearly empty image cannot establish alignment. Both overall and subject
  // agreement are required, so a shifted/scaled pale or small part is rejected.
  return foreground>=120&&error/(size*size)<5&&bad/(size*size)<.012&&foregroundBad/foreground<.035;
}
