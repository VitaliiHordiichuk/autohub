BEGIN;

UPDATE product_translations pt
SET
  name = p.name,
  provider = 'IMPORT',
  source_language = COALESCE(pt.source_language, 'de'),
  is_verified = FALSE,
  updated_at = CURRENT_TIMESTAMP
FROM products p
WHERE
  pt.product_id = p.id
  AND pt.provider <> 'MANUAL'
  AND LOWER(BTRIM(p.name)) = 'abdeckung'
  AND (
    (pt.language_code = 'uk' AND LOWER(BTRIM(pt.name)) = 'обсяг перекладу')
    OR (pt.language_code = 'ru' AND LOWER(BTRIM(pt.name)) IN ('область применения', 'охват'))
    OR (pt.language_code = 'en' AND LOWER(BTRIM(pt.name)) = 'coverage')
  );

UPDATE translation_memory
SET
  translated_text = source_text,
  provider = 'IMPORT',
  updated_at = CURRENT_TIMESTAMP
WHERE
  source_text_normalized = 'abdeckung'
  AND (
    (target_language = 'uk' AND LOWER(BTRIM(translated_text)) = 'обсяг перекладу')
    OR (target_language = 'ru' AND LOWER(BTRIM(translated_text)) IN ('область применения', 'охват'))
    OR (target_language = 'en' AND LOWER(BTRIM(translated_text)) = 'coverage')
  );

INSERT INTO schema_migrations(version)
VALUES ('073_repair_ambiguous_abdeckung_translations')
ON CONFLICT(version) DO NOTHING;

COMMIT;
