# Product image lifecycle: implementation and bounded R2 audit

Date: 2026-10-17. Base: `origin/main` d1a35db. No production writes, R2 uploads/deletes,
DNS changes, deployment, mass processing or Merchant feed edits were performed.

## Evidence (not a Google indexing diagnosis)

The previous worker created UUID keys on every run, published the new URLs, then immediately
deleted the previous four store objects and the CLEAN object. Reprocessing therefore made
previous direct R2 URLs disappear. A later product timestamp-update failure could enter the
same catch block as an upload failure, delete the new objects and reset the image to ORIGINAL.
Deletion failures were swallowed. Merchant-only backfill also deleted after ambiguous DB errors.

Those are confirmed code defects. They do not establish why Google stopped displaying any
particular image, nor guarantee reindexing. The owner reports the two Merchant products are
Approved; this work does not reinterpret them as rejected.

### Read-only sample

Two bounded `ListObjectsV2` calls, prefixes `products/6537/` and `products/6536/`, maximum
1000 keys each, neither truncated. Compared store keys with the public product API
(`productCard.product`, not the broader `family` array). Compared CLEAN keys with the
current public Merchant XML. HEAD checked every CLEAN URL: all 13 returned HTTP 200.

| Article / Merchant ID | Originals: count / bytes | Store derivatives: count / bytes | CLEAN: count / bytes | Total bytes |
| --- | ---: | ---: | ---: | ---: |
| A4653201502 / maka-6537 | 7 / 1,519,307 | 28 / 2,421,108 | 7 / 883,622 | 4,824,037 |
| A4653201602 / maka-6536 | 6 / 1,317,766 | 24 / 2,323,942 | 6 / 878,092 | 4,519,800 |
| Total | 13 / 2,837,073 | 52 / 4,745,050 | 13 / 1,761,714 | 9,343,837 |

The 65 derivatives match current public references: no surplus derivative versions were
found in these two prefixes. There is one 4+1 derivative set per photo, not ten sets.
Original objects were counted by their actual namespace; the production DB was not queried,
so the attachment of every original row was not independently verified. This is not a bucket-wide
orphan inventory. Unlisted, historical deleted keys cannot be inferred from the listing.
The local working DB has an older image schema and was not used as a production truth source.

## Architecture

* Migration 108 adds a request generation and a durable object ledger. No existing image
  URL or object is rewritten by the migration. There is no bucket enumeration in the worker/GC.
* Every photo keeps its original, including explicit removal from the storefront. An orphaned
  original from an interrupted upload is recorded and protected, not silently destroyed.
* Derivative keys contain the SHA-256 of **actual encoded bytes**, scoped to image and role.
  Same bytes reuse the existing key/URL, including old UUID-based images via a one-time byte
  comparison. Changing store branding does not churn an unchanged CLEAN image.
* Upload intents are persisted **before** PUT. Conditional `If-None-Match: *` prevents overwrites;
  Content-MD5 plus HEAD size/ETag (byte comparison for multipart ETags) verifies the object.
* All four store sizes and CLEAN must verify before publication. Image URLs/keys, ledger
  transitions and the product public timestamp switch in one PostgreSQL transaction.
* No failure handler deletes files or changes the previous display mode/URLs. A lost COMMIT
  response is safe. Interrupted/unpublished objects remain accounted for and collectable.
* A session advisory lock serializes workers, Merchant backfill, deletion and GC per photo.
  New admin requests increment a generation; a superseded worker cannot publish. Restoring
  ORIGINAL also increments the generation. Pending requests survive restarts via the existing
  PROCESSING recovery scheduler. A busy cross-process worker is left for the next recovery tick.
* Existing ADMIN/preview confirmation/file limits remain in place. The new public route is
  read-only and serves only previously published derivatives, never originals or upload intents.

### Managed public URLs

Opt in with `PRODUCT_IMAGE_DELIVERY_BASE_URL=https://maka.com.ua/api/product-media` **only after
the route has been verified through the actual public proxy/CDN**. No new DNS domain is required.
Changed/new storefront derivatives use the stable
`/api/product-media/{imageId}/site-{size}/current.webp` URL. Its immutable R2 object can
change after an approved reprocessing, while the public URL stays the same. CLEAN Merchant
derivatives use `/api/product-media/{imageId}/merchant-1500/{sha256}.webp`: unchanged bytes
keep the URL, changed bytes receive a new URL. Previously published hash URLs return a 302
directly to the latest version of the **same role**.
The historical metadata is kept after deleting its physical object. Random hashes do not resolve.
Store and Merchant branches cannot redirect into each other. After an explicit photo
replacement, old stable and managed hash URLs follow the replacement chain.

The final 200 response intentionally does not redirect to a disposable R2 key: that would expose
another breakable address to Google. GET/HEAD are public. Stable storefront responses use
`no-cache, must-revalidate` with content ETags; current managed hash responses cache for 1 hour,
redirects for 5 minutes. Temporary failures are 503/no-store/Retry-After, not cached 404s.
The application does not add noindex or require cookies. The current frontend robots allows `/`;
verify it and any proxy security rules at rollout. Keep this route available permanently once used.

Unchanged photos retain their existing URLs; only genuinely changed/new outputs opt into the
configured base. Nothing mass-converts image_link/additional_image_link or JSON-LD. Existing feed,
SEO selection, product IDs, pricing and other business logic are unchanged.

### Retention and economical cleanup

Normal managed state: one original plus four store WebPs and one CLEAN WebP. Superseded and
unpublished objects have a 7-day grace period, then become eligible. Ten **identical** runs create
no extra objects; distinct versions can coexist temporarily during the grace period, not forever.
Published alias rows remain as small DB records, not image copies.

`PRODUCT_IMAGE_GC_ENABLED=false` is the default. The CLI is read-only unless `--apply` is passed;
applying also requires the flag. When enabled, the existing scheduler attempts at most 20 objects
per hour. It never scans R2. Each deletion rechecks under the same per-photo lock:

1. Known managed derivative namespace, non-original role, expired retention, not protected.
2. No raw-key reference in product_images, homepage_banners, product data or product/category translations. These drive the site,
   public image sitemap/JSON-LD and Merchant feed. Managed old URLs resolve to current bytes.
3. No active processing; all currently linked derivative objects must be accessible.
4. Durable DELETING intent, idempotent R2 DELETE, then DELETED tombstone. Failures are recorded
   with attempts/error and retried after one hour; scheduler reports pending retries.

Unknown legacy leftovers are **not** automatically adopted/deleted by GC. A bounded audit and
reference review are required. Originals are never GC candidates, even after admin removal.
Do not add independent R2 lifecycle rules that bypass these checks. When manually embedding
photos outside normal MAKA components, use managed URLs, not internal physical object keys.

### Unavoidable legacy boundary

Already published direct `pub-*.r2.dev` objects are marked `legacy_public` and are **not automatically
deleted**. There is no safe expiration that both removes their bytes and keeps those exact URLs
working. With managed delivery enabled before further processing, these are a finite transition
baseline, not a new protected set on every edit. Leaving managed delivery unconfigured while
continuing distinct edits would accumulate protected direct versions; that is **not** the recommended
economical rollout. Identical edits are deduplicated in either delivery mode.

Do not clear legacy protection just to meet a storage target. An explicit owner decision after
reviewing old URL references/crawl evidence is required; deleting a direct URL will break it.
Existing external crawlers/caches cannot be exhaustively checked by SQL. The implementation
therefore makes no promise of automatic safe deletion of historical direct R2 URLs.

## Old URL recovery

* Existing old objects still serve their existing URL and can be protected.
* A known deleted key with an exact backup can technically be restored to that same key after
  separate approval and reference verification. No restore was executed here.
* An original alone does not reveal a lost UUID URL or guarantee byte-identical reproduction of
  an old crop/branding recipe. No old-URL inventory or backup of deleted derivatives was provided,
  so no specific deleted Google image URL is claimed recovered.
* The backend cannot intercept `pub-*.r2.dev`. Adding an R2 custom domain does not redirect that
  old host. R2 does not implement S3 website redirect metadata or S3 bucket versioning APIs:
  [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/),
  [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## Deployment checklist (NOT executed)

1. Review this branch, back up DB/schema and coordinate pausing photo edits/old workers.
2. Apply **108_product_image_lifecycle.sql** and **109_product_image_replacements.sql** using
   the existing migration procedure. Both are additive; do not deploy this worker against a
   pre-109 schema. Only the isolated local test DB was migrated.
3. Deploy all backend workers together. A mixed old/new worker rollout is unsafe because old code
   deletes files outside the new locks/ledger. Keep GC disabled.
4. Verify stable `/current.webp` and managed hash GET/HEAD, ETag revalidation, and old-to-new
   redirects using a deliberately approved test photo and a controlled host. Check actual
   Nginx routing, robots, HTTPS and CDN responses.
   Do not assume extension-specific proxy rules pass the route; do not enable managed URLs until proven.
5. Set the delivery base to the verified public endpoint. No mass URL update/reprocess is required.
   Validate both branded and CLEAN results, Merchant/SEO references and the original restore switch.
6. After the grace period, inspect `node scripts/collect-product-image-garbage.mjs --limit=20`.
   Approve cleanup separately; only then set GC true. No production apply command was run here.
7. Monitor 5xx/media, processing errors, GC retry backlog and protected legacy storage size.

Cloudflare changes are **not required** for the backend-mediated endpoint on the current site host.
An optional cache rule for `/api/product-media/*` (eligible public image responses, respect origin
Cache-Control, never cache 5xx) would reduce backend bandwidth/R2 GETs. Inspect existing rules and
obtain approval before adding it. No Images subscription, DNS or new public bucket domain is needed.

Rollback: first disable GC and pause photo writes. Keep migration/ledger and the public delivery
route; do not deploy an old backend that removes that route or restores immediate deletion after
managed URLs have been published. An algorithm rollback can use the existing LEGACY mode without
removing the safe lifecycle. Do not drop the ledger: it contains recovery intents and public aliases.

## Verification

Full isolated backend suite: 621/621; final focused run: 27/27 (including 16 new real-PostgreSQL
lifecycle tests). R2 was
an in-memory test double; production credentials were never used for a write. Migration 108 applied
only to local `maka_image_lifecycle_test`. Existing Merchant feed, SEO CLEAN selection, image processor,
admin authorization and preview-confirmation tests passed. No frontend files or build inputs changed.
