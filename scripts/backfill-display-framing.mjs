import { pool } from '../src/config/db.js';
import { ProductImageFramingService } from '../src/services/ProductImageFramingService.js';
const args=process.argv.slice(2);
if(args.some(a=>!['--apply','--all'].includes(a)))throw new Error('Usage: node scripts/backfill-display-framing.mjs [--apply] [--all]');
if(process.env.PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED!=='true')throw new Error('Display framing flag is off');
let cursor=0;
try {
  do {
    const results=await ProductImageFramingService.recover({limit:20,cursor,dryRun:!args.includes('--apply')});
    for(const result of results)console.log(JSON.stringify(result));
    if(!results.length)break;
    cursor=Number(results.at(-1).id);
  } while(args.includes('--all'));
} finally { await pool.end(); }
