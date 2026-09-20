# Product image processing

Product uploads keep the untouched original in Cloudflare R2 and enqueue an asynchronous optimization job. The public `url` switches to a 1500 × 1500 processed WebP after a successful job. A failed job keeps the original public and can be retried from the admin page.

## Deploy

1. Apply database migrations through `083_add_product_image_quality_metadata.sql` before starting the new backend.
2. Restart the backend. On startup it resumes up to 20 interrupted image jobs and checks for more once per minute.

No Docker container, external image API or per-image payment is required.

## Generated files

- untouched original in `products/<productId>/originals/`;
- branded square WebP variants at 1500, 1200, 800 and 400 px in `products/<productId>/processed/`;
- automatic EXIF orientation correction and metadata removal in processed copies;
- 1500 × 1500 white canvas with the source centered and fully visible;
- proportional scaling capped at `MAX_UPSCALE = 1.5` so small originals are never enlarged more than 1.5 times;
- WebP quality 89;
- visible diagonal MAKA watermark, repeating pattern and permanent `maka.com.ua` signature.

The existing database columns ending in `_1600` remain as the primary processed-image slot for backward compatibility. New files stored in that slot are physically 1500 × 1500 and use a `-1500.webp` object key.

## Quality metadata

New and reprocessed photos record the oriented original dimensions, processed dimensions and a quality status. Existing photos remain unchanged and are not backfilled automatically.

- `GOOD`: the smaller original dimension is at least 1000 px;
- `OK`: the smaller original dimension is 500–999 px;
- `LOW_RESOLUTION`: the smaller original dimension is below 500 px.

Low resolution is informational and never blocks upload or processing. Merchant Center receives the processed URL after successful processing and falls back to the untouched original while processing or after a failure.
