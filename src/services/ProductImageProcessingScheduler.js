import { ProductImageService } from "./ProductImageService.js";

let timer = null;

export function startProductImageProcessingScheduler() {
  const recover = () => ProductImageService.recoverPending().catch((error) => {
    console.error("Product image recovery failed:", error.message);
  });
  recover();
  timer = setInterval(recover, 60_000);
  timer.unref?.();
}
