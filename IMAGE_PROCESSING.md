# Product image processing

Product uploads keep the untouched original in Cloudflare R2 and enqueue an asynchronous optimization job. The public `url` switches to the 1600 px processed WebP after a successful job. A failed job keeps the original public and can be retried from the admin page.

## Deploy

1. Apply database migration `061_add_product_image_processing.sql` before starting the new backend.
2. Restart the backend. On startup it resumes up to 20 interrupted image jobs and checks for more once per minute.

No Docker container, external image API or per-image payment is required.

## Generated files

- untouched original in `products/<productId>/originals/`;
- branded WebP variants at 1600, 1200, 800 and 400 px in `products/<productId>/processed/`;
- automatic EXIF orientation correction and metadata removal in processed copies;
- square white canvas without destructive background removal;
- visible diagonal MAKA watermark, repeating pattern and permanent `maka.com.ua` signature.
