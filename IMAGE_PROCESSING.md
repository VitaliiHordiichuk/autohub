# Product image processing

Product uploads keep the untouched original in Cloudflare R2 and enqueue an asynchronous optimization job. The public `url` switches to a 1500 × 1500 processed WebP after a successful job. A failed job keeps the original public and can be retried from the admin page.

## Deploy

1. Apply database migrations through `085_add_product_image_merchant_version.sql` before starting the new backend.
2. Restart the backend. On startup it resumes up to 20 interrupted image jobs and checks for more once per minute.

No Docker container, external image API or per-image payment is required.

## Generated files

- untouched original in `products/<productId>/originals/`;
- square WebP variants at 1500, 1200, 800 and 400 px in `products/<productId>/processed/`;
- a separate clean 1500 px Google Merchant WebP in `products/<productId>/merchant/`;
- automatic EXIF orientation correction and metadata removal in processed copies;
- 1500 × 1500 white canvas with the source centered and fully visible;
- proportional scaling capped at `MAX_UPSCALE = 1.5` so small originals are never enlarged more than 1.5 times;
- WebP quality 89;
- optional MAKA branding selected by the configured branding mode.

## Automatic crop and composition

Processing version 4 normalizes the product composition before branding. It samples the four outer corners and only enables automatic cropping when the outer background is sufficiently uniform. The processor then finds the content boundary, removes the external empty area and rebuilds equal white margins around the detected product. A non-uniform photographic background safely falls back to the full original bounds instead of risking removal of a product part.

- `TARGET_FILL_RATIO = 0.85`: the dominant side of a sufficiently large product aims for 85% of the 1500 px canvas (1275 px);
- `CROP_PADDING_RATIO = 0.08`: an 8% safe white margin is added on every side of the detected product before it is centred;
- `MAX_UPSCALE = 1.5`: the detected product region is never enlarged by more than 1.5 times.

The target ratio is therefore best effort. A small source remains below 85% when reaching it would exceed the upscale limit. Horizontal and vertical products keep their proportions, remain fully visible and are centred on the 1500 × 1500 white canvas. The crop and composition step runs before `CLEAN`, `STAMP_ONLY` or `FULL_BRANDED`, so every branding mode uses the same prepared product image.

The quality status still uses the oriented original dimensions, not the cropped region or final canvas. No existing image is reprocessed automatically. A later maintenance command can reuse `detectProductBounds` and `normalizeProductComposition` to process selected originals explicitly. New uploads and manual reprocessing create both the storefront and Merchant branches from the untouched original.

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

The admin interface sends the selected mode with upload and reprocess requests. Migration `084_add_product_image_branding_mode.sql` stores that choice on the image so an asynchronous or recovered job always uses the requested mode. Existing images are marked `FULL_BRANDED` without being reprocessed.

## Quality metadata

New and reprocessed photos record the oriented original dimensions, processed dimensions and a quality status. Existing photos remain unchanged and are not backfilled automatically.

- `GOOD`: the smaller original dimension is at least 1000 px;
- `OK`: the smaller original dimension is 500–999 px;
- `LOW_RESOLUTION`: the smaller original dimension is below 500 px.

Low resolution is informational and never blocks upload or processing.

## Storefront and Google Merchant branches

The shared normalization step runs once from the original and then splits into two independent outputs:

```text
ORIGINAL
   |
   +-- normalize composition / auto-crop / padding / MAX_UPSCALE
          |
          +-- SITE: CLEAN / STAMP_ONLY / FULL_BRANDED
          |
          +-- GOOGLE MERCHANT: CLEAN only
```

The storefront keeps the administrator-selected branding mode and writes its responsive files under `products/<productId>/processed/`. Google Merchant always encodes the normalized pre-branding canvas as a separate physical 1500 × 1500 WebP under:

```text
products/<productId>/merchant/<article>-photo-<imageId>-<revision>-clean-1500.webp
```

Migration `085_add_product_image_merchant_version.sql` adds nullable `merchant_url_1500` and `merchant_storage_key_1500` columns. It does not backfill or reprocess existing rows. A new upload creates the original, all selected site variants and the Merchant CLEAN file in the same asynchronous job. Reprocessing creates new immutable URLs for both branches, updates the database only after every upload succeeds, and removes the superseded object keys afterward.

The Merchant feed uses the following safe image order:

1. `merchant_url_1500`;
2. `original_url`.

It never falls back to `processed_url_1600` or the public `url`, because either can contain `STAMP_ONLY` or `FULL_BRANDED` overlays. Existing images receive a dedicated Merchant URL only after explicit reprocessing; until then the feed uses their untouched original.

## Storefront, search indexing and social images

The public product SEO endpoint keeps storefront and indexing images separate:

- `product.images` contains the existing public gallery URLs. These are used by the visible product gallery and may use the administrator-selected `CLEAN`, `STAMP_ONLY` or `FULL_BRANDED` site version;
- `product.seoImages` contains only `merchant_url_1500`, falling back to `original_url` for the same image row. It never falls back to the public `url` or any processed site variant;
- Product and WebPage structured data use `product.seoImages`, so Google Search receives the same clean-or-original image policy as Google Merchant;
- Open Graph and Twitter metadata continue to use the public gallery images for social sharing.

If neither a Merchant CLEAN URL nor an original URL exists, the SEO endpoint returns no indexing image for that row. The frontend then omits the Product entity instead of exposing a branded processed image as a Google product image.

## Controlled Merchant image backfill

Existing rows without a complete Merchant image pair can be processed in explicit batches. The command is never started by a migration, application startup or scheduler.

Preview the first batch without reading or writing R2 and without changing the database:

```bash
npm run backfill:merchant-images -- --dry-run --limit=50 --cursor=0
```

Run a real batch:

```bash
npm run backfill:merchant-images -- --limit=50 --cursor=0
```

Supported parameters:

- `--limit`: number of missing Merchant images to scan, from 1 to 500; default 50;
- `--cursor`: only scan image IDs greater than this value; default 0;
- `--dry-run`: report candidates and skip reasons without processing, uploading or database writes;
- `--help`: print command usage.

The report contains `scanned`, `eligible`, `processed`, `skipped`, `failed`, per-reason counters and `nextCursor`. Use the reported cursor for the next forward batch. A failed image remains without a Merchant URL and is therefore retried by starting again with a cursor below its ID, commonly `--cursor=0`.

The backfill reads only the untouched `original_storage_key`, applies the shared Merchant-only normalization pipeline, uploads a new immutable CLEAN file under `products/<productId>/merchant/`, and updates only `merchant_url_1500` and `merchant_storage_key_1500`. It does not alter or delete originals, site processed files, `image_branding_mode`, `display_mode` or product data. Rows already containing both Merchant fields are idempotently skipped, including when another backfill process completes the same row concurrently.

One inaccessible or invalid image does not stop the rest of the batch. The final report distinguishes `already_has_merchant`, `missing_original`, `original_not_accessible`, `processing_error`, `upload_error` and `db_update_error`. If an upload succeeds but the guarded database update fails or loses a race, the newly uploaded object is removed and the existing row is preserved.
