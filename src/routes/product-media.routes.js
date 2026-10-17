import { Router } from 'express';
import { pool } from '../config/db.js';
import { createProductImageStorage } from '../services/ProductImageService.js';
import { resolvePublishedImage } from '../services/ProductImageLifecycle.js';

export function createProductMediaRouter({ db = pool, storageFactory = createProductImageStorage } = {}) {
  const router = Router();
  router.get('/:imageId/:role/:file', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const hash = /^([a-f0-9]{64})\.webp$/.exec(req.params.file)?.[1];
    if (!hash) return res.sendStatus(404);
    try {
      const image = await resolvePublishedImage(db, req.params.imageId, req.params.role, hash);
      if (!image) return res.sendStatus(404);
      if (image.sha256 !== hash) {
        // Only previously published versions resolve. Never redirect to a caller-supplied URL.
        const target = `/api/product-media/${req.params.imageId}/${req.params.role}/${image.sha256}.webp`;
        return res.set('Cache-Control', 'public, max-age=300').redirect(302, target);
      }
      // Do not expose a disposable R2 URL as a redirect target: Google would rediscover it.
      // Old version URLs redirect here; the current version returns the actual image bytes.
      const storage = storageFactory();
      if (req.method === 'HEAD') {
        const head = await storage.head(image.storage_key);
        return res.set({ 'Content-Type': 'image/webp', 'Content-Length': String(head.ContentLength),
          'Cache-Control': 'public, max-age=3600', ETag: `"${hash}"` }).end();
      }
      const body = await storage.read(image.storage_key);
      return res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff', ETag: `"${hash}"` }).send(body);
    } catch {
      // Transient storage/DB errors must not become a cached missing-image response.
      return res.set({ 'Cache-Control': 'no-store', 'Retry-After': '60' }).sendStatus(503);
    }
  });
  return router;
}

export const productMediaRouter = createProductMediaRouter();
