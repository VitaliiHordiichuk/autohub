# Product image processing

Product uploads keep the untouched original in Cloudflare R2 and enqueue an asynchronous optimization job. The public `url` switches to a 1500 × 1500 processed WebP after a successful job. A failed job keeps the original public and can be retried from the admin page.

## Deploy

1. Apply database migrations through `083_add_product_image_quality_metadata.sql` before starting the new backend.
2. Restart the backend. On startup it resumes up to 20 interrupted image jobs and checks for more once per minute.

No Docker container, external image API or per-image payment is required.

## Generated files

- untouched original in `products/<productId>/originals/`;
- square WebP variants at 1500, 1200, 800 and 400 px in `products/<productId>/processed/`;
- automatic EXIF orientation correction and metadata removal in processed copies;
- 1500 × 1500 white canvas with the source centered and fully visible;
- proportional scaling capped at `MAX_UPSCALE = 1.5` so small originals are never enlarged more than 1.5 times;
- WebP quality 89;
- optional MAKA branding selected by the configured branding mode.

The existing database columns ending in `_1600` remain as the primary processed-image slot for backward compatibility. New files stored in that slot are physically 1500 × 1500 and use a `-1500.webp` object key.

## Branding modes

`PRODUCT_IMAGE_BRANDING_MODE` controls branding for new and manually reprocessed images. Supported values:

- `CLEAN`: no repeating watermark and no bottom stamp;
- `STAMP_ONLY`: only the bottom `MAKA.com.ua` stamp;
- `FULL_BRANDED`: the bottom stamp plus a lighter repeating watermark. This is the default.

Set the mode in the backend environment, for example:

```env
PRODUCT_IMAGE_BRANDING_MODE=STAMP_ONLY
```

Code that needs a one-off override can pass `brandingMode` directly:

```js
await processProductImage(input, {
  brandingMode: IMAGE_BRANDING_MODE.CLEAN,
});
```

An explicit function option takes priority over the environment. The `FULL_BRANDED` grid uses a 620 × 420 px step instead of the previous 360 × 245 px step, and its opacity is 0.28 instead of 0.45. The bottom stamp keeps its previous size and position.

Changing the mode does not reprocess existing files. It applies only to later uploads and images explicitly sent for reprocessing.

## Quality metadata

New and reprocessed photos record the oriented original dimensions, processed dimensions and a quality status. Existing photos remain unchanged and are not backfilled automatically.

- `GOOD`: the smaller original dimension is at least 1000 px;
- `OK`: the smaller original dimension is 500–999 px;
- `LOW_RESOLUTION`: the smaller original dimension is below 500 px.

Low resolution is informational and never blocks upload or processing. Merchant Center receives the processed URL after successful processing and falls back to the untouched original while processing or after a failure.
