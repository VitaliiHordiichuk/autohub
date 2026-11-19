# Storefront image framing

The storefront frames the visible product using `product_images.image_display_frame` (migration134, `PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED=true`). It does not rewrite image bytes, object keys, selected URLs, responsive URLs or Merchant URLs. Existing hardcoded reviewed card windows remain the fallback when metadata is absent.

Automatic detection only removes confident white margins. All detected parts are included. An existing clean Merchant counterpart may be analysed only after pixel comparison confirms that its composition matches the displayed branded photo. Ambiguous backgrounds, low contrast, edge contact, unavailable files and unmatched watermarks remain complete with REVIEW status. REVIEW does not block product publication.

New processed uploads derive framing from the same aligned clean branch in their publication transaction. The existing image-recovery scheduler handles missing/stale metadata in batches of two per minute. Manual decisions are preserved while the selected source URL/key/generation remains current.

In Admin → Product photos, use **Card image framing**. Automatic / Manual / Full photo change metadata only. Manual bounds must include the entire product, kit and markings. The editor checks source/frame revisions and refuses stale saves (409); it is ADMIN-only. Existing physical reprocessing tools remain separate.

`PRODUCT_IMAGE_DISPLAY_FRAMING_ENABLED=true node scripts/backfill-display-framing.mjs --all` is a dry-run. Add `--apply` for bounded metadata writes. It never uploads or deletes R2 objects. Back up the table first; compare every URL/key field before and after. Do not run physical image reprocessing as a framing backfill.

Rollback: disable the flag and restore the previous API/Frontend source. The nullable column and metadata may remain; old source ignores them. Do not drop data to roll back presentation. A full DB snapshot is unnecessary: save the image rows and product timestamps affected by this release and preserve concurrent product edits.
