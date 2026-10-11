# Smart product image processing — safe rollout

The existing processor remains the default. Stage 1 does not reprocess existing images and does not change the Merchant feed implementation.

## Feature flag

```dotenv
SMART_PRODUCT_IMAGES_ENABLED=false
```

- `false` or absent: the admin keeps the existing LEGACY upload/reprocess controls.
- `true`: the admin opens PRODUCT MAX by default and can switch to SMART SAFE or PRODUCT FOCUS before confirming an upload or reprocess operation.
- Turning the flag off restores the LEGACY processor for new/recovered jobs. Original files and previously generated versioned files stay intact.

Do not enable the flag until migration `106_add_smart_product_image_processing.sql` has been reviewed and applied in the target environment.

## Modes

- `PRODUCT_MAX`: targets 88% of the longest confidently detected content dimension. It may enlarge a small source for display while retaining `LOW_RESOLUTION`; it never claims to recover detail or applies sharpening. Automatic cropping is limited to a high-confidence uniform border. Uncertain backgrounds keep the complete frame and recommend manual bounds only when they are actually needed.
- `SMART_SAFE`: crops only a high-confidence uniform outer border. A non-uniform, textured or edge-adjacent composition uses the complete original frame and can be marked `NEEDS_REVIEW`.
- `PRODUCT_FOCUS`: requires a normalized manual crop. It begins with the complete frame; packaging and fasteners are not excluded automatically.
- `LEGACY`: keeps the previous version 4 processor and branding configuration.

PRODUCT MAX and SMART modes always create clean WebP derivatives without a watermark. The 1500, 1200, 800 and 400 pixel site variants and the 1500 pixel Merchant variant retain the existing immutable, versioned R2 key scheme.

## Publication and rollback

Preview requests are read-only and do not write to PostgreSQL or R2. A short-lived signed confirmation is bound to the exact source and processing settings, so a SMART upload/reprocess cannot start until the administrator has previewed and confirmed that result. Each SMART upload is confirmed separately.

Processing always reads `original_storage_key`; it never chains compression from an already processed WebP. On success, database URLs switch atomically to a new version. The existing “Use original” action restores `original_url` without deleting the original or processed files.

## Production safeguards

1. Keep the flag off during deployment and migration review.
2. Validate 15–20 supplied real originals in preview mode.
3. Obtain visual approval for the contact sheet.
4. Enable only for an administrator-controlled pilot product.
5. Do not run a mass reprocess or Merchant backfill as part of this rollout.
