import {
  pool,
} from "../config/db.js";


function normalizeLimit(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return 25;
  }

  return Math.min(parsed, 100);
}


export const AutomaticTranslationRepository = {
  async acquireRunLock() {
    const db = await pool.connect();

    const result =
      await db.query(
        `
          SELECT
            pg_try_advisory_lock(
              hashtext($1),
              hashtext($2)
            ) AS locked
        `,
        [
          "autohub",
          "automatic-product-translations",
        ]
      );

    if (
      result.rows[0]?.locked !== true
    ) {
      db.release();
      return null;
    }

    return db;
  },


  async releaseRunLock(db) {
    if (!db) {
      return;
    }

    try {
      await db.query(
        `
          SELECT
            pg_advisory_unlock(
              hashtext($1),
              hashtext($2)
            )
        `,
        [
          "autohub",
          "automatic-product-translations",
        ]
      );

    } finally {
      db.release();
    }
  },


  async resetStaleProcessing() {
    await pool.query(
      `
        UPDATE product_translation_jobs
        SET
          status = 'PENDING',
          last_error =
            'Відновлено після перерванoї обробки',
          next_attempt_at = NOW(),
          updated_at = NOW()

        WHERE
          status = 'PROCESSING'
          AND updated_at <
            NOW() - INTERVAL '30 minutes'
      `
    );
  },


  async claimJobs(limitValue) {
    const limit =
      normalizeLimit(limitValue);

    const result =
      await pool.query(
        `
          WITH picked AS (
            SELECT
              j.product_id,
              p.article,
              p.name AS source_name

            FROM product_translation_jobs j

            JOIN products p
              ON p.id = j.product_id

            WHERE
              j.status IN (
                'PENDING',
                'FAILED'
              )
              AND j.next_attempt_at <= NOW()
              AND j.attempt_count < 7
              AND p.name IS NOT NULL
              AND BTRIM(p.name) <> ''

            ORDER BY
              j.updated_at ASC,
              j.product_id ASC

            FOR UPDATE OF j
            SKIP LOCKED

            LIMIT $1
          )

          UPDATE product_translation_jobs j
          SET
            status = 'PROCESSING',
            attempt_count =
              j.attempt_count + 1,
            last_error = NULL,
            updated_at = NOW()

          FROM picked

          WHERE
            j.product_id =
              picked.product_id

          RETURNING
            j.product_id,
            j.attempt_count,
            picked.article,
            picked.source_name
        `,
        [limit]
      );

    return result.rows.map(
      (row) => ({
        productId:
          Number(row.product_id),

        article:
          row.article,

        sourceName:
          row.source_name,

        attemptCount:
          Number(row.attempt_count),
      })
    );
  },


  async getExistingTranslations(
    productIds
  ) {
    if (
      !Array.isArray(productIds) ||
      productIds.length === 0
    ) {
      return [];
    }

    const result =
      await pool.query(
        `
          SELECT
            product_id,
            language_code,
            name,
            provider,
            source_language,
            is_verified

          FROM product_translations

          WHERE
            product_id = ANY($1::bigint[])
        `,
        [productIds]
      );

    return result.rows.map(
      (row) => ({
        productId:
          Number(row.product_id),

        languageCode:
          row.language_code,

        name:
          row.name,

        provider:
          row.provider,

        sourceLanguage:
          row.source_language,

        isVerified:
          row.is_verified === true,
      })
    );
  },


  async getMemoryByNormalizedSources(
    normalizedSources
  ) {
    if (
      !Array.isArray(normalizedSources) ||
      normalizedSources.length === 0
    ) {
      return [];
    }

    const result =
      await pool.query(
        `
          SELECT
            source_language,
            source_text,
            source_text_normalized,
            target_language,
            translated_text,
            provider

          FROM translation_memory

          WHERE
            source_text_normalized =
              ANY($1::text[])

          ORDER BY
            updated_at DESC
        `,
        [normalizedSources]
      );

    return result.rows.map(
      (row) => ({
        sourceLanguage:
          row.source_language,

        sourceText:
          row.source_text,

        normalizedSource:
          row.source_text_normalized,

        targetLanguage:
          row.target_language,

        translatedText:
          row.translated_text,

        provider:
          row.provider,
      })
    );
  },


  async upsertAutomaticTranslation(
    {
      productId,
      languageCode,
      name,
      provider,
      sourceLanguage,
    }
  ) {
    const result =
      await pool.query(
        `
          INSERT INTO product_translations (
            product_id,
            language_code,
            name,
            provider,
            source_language,
            is_verified
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            FALSE
          )

          ON CONFLICT (
            product_id,
            language_code
          )
          DO UPDATE SET
            name =
              EXCLUDED.name,

            provider =
              EXCLUDED.provider,

            source_language =
              EXCLUDED.source_language,

            is_verified =
              FALSE,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            product_translations.provider
              <> 'MANUAL'

          RETURNING
            product_id,
            language_code,
            name,
            provider,
            source_language,
            is_verified,
            created_at,
            updated_at
        `,
        [
          productId,
          languageCode,
          name,
          provider,
          sourceLanguage,
        ]
      );

    return result.rows[0] ?? null;
  },


  async upsertMemory(
    {
      sourceLanguage,
      sourceText,
      normalizedSource,
      targetLanguage,
      translatedText,
      provider,
    }
  ) {
    await pool.query(
      `
        INSERT INTO translation_memory (
          source_language,
          source_text,
          source_text_normalized,
          target_language,
          translated_text,
          provider,
          use_count
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          1
        )

        ON CONFLICT (
          source_language,
          source_text_normalized,
          target_language
        )
        DO UPDATE SET
          source_text =
            EXCLUDED.source_text,

          translated_text =
            EXCLUDED.translated_text,

          provider =
            EXCLUDED.provider,

          use_count =
            translation_memory.use_count + 1,

          updated_at =
            CURRENT_TIMESTAMP
      `,
      [
        sourceLanguage,
        sourceText,
        normalizedSource,
        targetLanguage,
        translatedText,
        provider,
      ]
    );
  },


  async markCompleted(
    {
      productId,
      detectedSourceLanguage,
      billedCharacters,
    }
  ) {
    await pool.query(
      `
        UPDATE product_translation_jobs
        SET
          status = 'COMPLETED',
          detected_source_language = $2,
          billed_characters =
            billed_characters + $3,
          last_error = NULL,
          next_attempt_at = NOW(),
          completed_at = NOW(),
          updated_at = NOW()

        WHERE product_id = $1
      `,
      [
        productId,
        detectedSourceLanguage,
        billedCharacters,
      ]
    );
  },


  async markFailed(
    {
      productId,
      errorMessage,
      attemptCount,
    }
  ) {
    const delayMinutes =
      Math.min(
        24 * 60,
        Math.max(
          5,
          5 *
            (2 ** Math.max(
              0,
              Number(attemptCount) - 1
            ))
        )
      );

    await pool.query(
      `
        UPDATE product_translation_jobs
        SET
          status = 'FAILED',
          last_error = $2,
          next_attempt_at =
            NOW() +
            ($3 * INTERVAL '1 minute'),
          updated_at = NOW()

        WHERE product_id = $1
      `,
      [
        productId,
        String(errorMessage || "")
          .slice(0, 2000),
        delayMinutes,
      ]
    );
  },


  async requeueFailed() {
    const result =
      await pool.query(
        `
          UPDATE product_translation_jobs
          SET
            status = 'PENDING',
            attempt_count = 0,
            last_error = NULL,
            next_attempt_at = NOW(),
            updated_at = NOW()

          WHERE status = 'FAILED'

          RETURNING product_id
        `
      );

    return result.rowCount;
  },


  async getStatus() {
    const result =
      await pool.query(
        `
          SELECT
            status,
            COUNT(*)::int AS count
          FROM product_translation_jobs
          GROUP BY status
        `
      );

    const totals = {
      PENDING: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };

    for (
      const row of result.rows
    ) {
      totals[row.status] =
        Number(row.count);
    }

    const memoryResult =
      await pool.query(
        `
          SELECT
            COUNT(*)::int AS entries,
            COALESCE(
              SUM(use_count),
              0
            )::int AS uses
          FROM translation_memory
        `
      );

    const billedResult =
      await pool.query(
        `
          SELECT
            COALESCE(
              SUM(billed_characters),
              0
            )::bigint AS billed_characters
          FROM product_translation_jobs
        `
      );

    return {
      jobs: totals,

      memory: {
        entries:
          Number(
            memoryResult
              .rows[0]
              ?.entries || 0
          ),

        uses:
          Number(
            memoryResult
              .rows[0]
              ?.uses || 0
          ),
      },

      billedCharacters:
        Number(
          billedResult
            .rows[0]
            ?.billed_characters || 0
        ),
    };
  },
};
