import { ProductImageFramingService } from './ProductImageFramingService.js';
import { ProductImageService } from "./ProductImageService.js";
import { collectProductImageGarbage } from './ProductImageGarbageCollector.js';

let timer = null;
let garbageTimer = null;
let collecting = false;
let framing = false;

export function startProductImageProcessingScheduler() {
  if (timer) return;
  const recover = () => ProductImageService.recoverPending().catch((error) => {
    console.error("Product image recovery failed:", error.message);
  });
  const recoverFraming = async () => {
    if(framing)return;framing=true;
    try { await ProductImageFramingService.recover(); }
    catch(error){ console.error('Product display framing recovery failed:',error.message); }
    finally { framing=false; }
  };
  const framingTimer=setInterval(recoverFraming,60_000);framingTimer.unref?.();
  recover();
  timer = setInterval(recover, 60_000);
  timer.unref?.();
  if (process.env.PRODUCT_IMAGE_GC_ENABLED === 'true') {
    garbageTimer = setInterval(async () => {
      if (collecting) return;
      collecting = true;
      try {
        const result = await collectProductImageGarbage({ apply: true });
        const retries = result.results.filter(item => item.result === 'retry').length;
        if (retries) console.warn(`Product image cleanup: ${retries} objects pending retry; see product_image_objects.last_error`);
      }
      catch (error) { console.error('Product image cleanup failed:', error.message); }
      finally { collecting = false; }
    }, 60 * 60 * 1000);
    garbageTimer.unref?.();
  }
}
