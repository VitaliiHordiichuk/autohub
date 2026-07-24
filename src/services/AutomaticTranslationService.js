import "dotenv/config";

import * as deepl
  from "deepl-node";

import {
  AutomaticTranslationRepository,
} from "../repositories/AutomaticTranslationRepository.js";


const TARGETS = [
  {
    languageCode: "uk",
    deeplCode: "uk",
  },
  {
    languageCode: "en",
    deeplCode: "en-GB",
  },
  {
    languageCode: "ru",
    deeplCode: "ru",
  },
];


const TRANSLATION_CONTEXT = [
  "These texts are concise automotive spare-part names",
  "for an online auto-parts catalog.",
  "Preserve brand names, article numbers, OEM numbers,",
  "dimensions, abbreviations, left/right, front/rear,",
  "engine codes and technical meaning.",
  "Return only the translated product name.",
].join(" ");


let deeplClient = null;


function isEnabled() {
  const value =
    String(
      process.env
        .AUTO_TRANSLATION_ENABLED ||
      ""
    )
      .trim()
      .toLowerCase();

  return [
    "true",
    "1",
    "yes",
    "on",
  ].includes(value);
}


function normalizeBatchSize(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return 25;
  }

  return Math.min(parsed, 100);
}


function getBatchSize() {
  return normalizeBatchSize(
    process.env
      .AUTO_TRANSLATION_BATCH_SIZE
  );
}


function normalizeSourceText(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function normalizeDetectedLanguage(
  value
) {
  const code =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    code.startsWith("en")
  ) {
    return "en";
  }

  if (
    code.startsWith("uk")
  ) {
    return "uk";
  }

  if (
    code.startsWith("ru")
  ) {
    return "ru";
  }

  return code || "unknown";
}


function getClient() {
  if (deeplClient) {
    return deeplClient;
  }

  const authKey =
    String(
      process.env
        .DEEPL_AUTH_KEY || ""
    ).trim();

  if (!authKey) {
    throw new Error(
      "У .env відсутній DEEPL_AUTH_KEY"
    );
  }

  deeplClient =
    new deepl.DeepLClient(
      authKey,
      {
        appInfo: {
          appName:
            "AutoHub",
          appVersion:
            "0.1.0",
        },
        maxRetries: 5,
        minTimeout: 60000,
      }
    );

  return deeplClient;
}


function groupExistingTranslations(
  rows
) {
  const map = new Map();

  for (const row of rows) {
    if (
      !map.has(row.productId)
    ) {
      map.set(
        row.productId,
        new Map()
      );
    }

    map
      .get(row.productId)
      .set(
        row.languageCode,
        row
      );
  }

  return map;
}


function groupMemory(rows) {
  const map = new Map();

  for (const row of rows) {
    if (
      !map.has(
        row.normalizedSource
      )
    ) {
      map.set(
        row.normalizedSource,
        new Map()
      );
    }

    const byLanguage =
      map.get(
        row.normalizedSource
      );

    if (
      !byLanguage.has(
        row.sourceLanguage
      )
    ) {
      byLanguage.set(
        row.sourceLanguage,
        new Map()
      );
    }

    byLanguage
      .get(row.sourceLanguage)
      .set(
        row.targetLanguage,
        row
      );
  }

  return map;
}


function findCompleteMemory(
  groupedMemory,
  normalizedSource
) {
  const byLanguage =
    groupedMemory.get(
      normalizedSource
    );

  if (!byLanguage) {
    return null;
  }

  for (
    const [
      sourceLanguage,
      translations,
    ] of byLanguage
  ) {
    const complete =
      TARGETS.every(
        ({ languageCode }) =>
          translations.has(
            languageCode
          )
      );

    if (complete) {
      return {
        sourceLanguage,
        translations,
      };
    }
  }

  return null;
}


function preserveManualTranslations(
  product,
  existingByProduct
) {
  const existing =
    existingByProduct.get(
      product.productId
    ) || new Map();

  const manual = new Map();

  for (
    const [
      languageCode,
      translation,
    ] of existing
  ) {
    if (
      translation.provider ===
      "MANUAL"
    ) {
      manual.set(
        languageCode,
        translation.name
      );
    }
  }

  return manual;
}


async function translateTexts(
  texts,
  targetCode
) {
  if (texts.length === 0) {
    return [];
  }

  const client = getClient();

  const result =
    await client.translateText(
      texts,
      null,
      targetCode,
      {
        splitSentences: "off",
        preserveFormatting: true,
        context:
          TRANSLATION_CONTEXT,
      }
    );

  return Array.isArray(result)
    ? result
    : [result];
}


async function saveProductTranslations(
  {
    product,
    sourceLanguage,
    translations,
    providers,
    manualTranslations,
    billedCharacters,
  }
) {
  const normalizedSource =
    normalizeSourceText(
      product.sourceName
    );

  for (
    const {
      languageCode,
    } of TARGETS
  ) {
    const manualName =
      manualTranslations.get(
        languageCode
      );

    if (manualName) {
      continue;
    }

    const name =
      String(
        translations.get(
          languageCode
        ) || ""
      ).trim();

    if (!name) {
      throw new Error(
        `Порожній переклад ${languageCode} для ${product.article}`
      );
    }

    const provider =
      providers.get(
        languageCode
      ) || "DEEPL";

    await AutomaticTranslationRepository
      .upsertAutomaticTranslation({
        productId:
          product.productId,

        languageCode,
        name,
        provider,
        sourceLanguage,
      });

    await AutomaticTranslationRepository
      .upsertMemory({
        sourceLanguage,

        sourceText:
          product.sourceName,

        normalizedSource,
        targetLanguage:
          languageCode,

        translatedText:
          name,

        provider,
      });
  }

  await AutomaticTranslationRepository
    .markCompleted({
      productId:
        product.productId,

      detectedSourceLanguage:
        sourceLanguage,

      billedCharacters,
    });
}


async function applyMemoryProduct(
  {
    product,
    memory,
    manualTranslations,
  }
) {
  const translations =
    new Map();

  const providers =
    new Map();

  for (
    const {
      languageCode,
    } of TARGETS
  ) {
    const row =
      memory.translations.get(
        languageCode
      );

    translations.set(
      languageCode,
      row.translatedText
    );

    providers.set(
      languageCode,
      "MEMORY"
    );
  }

  await saveProductTranslations({
    product,

    sourceLanguage:
      memory.sourceLanguage,

    translations,
    providers,
    manualTranslations,
    billedCharacters: 0,
  });
}


async function translateProducts(
  products,
  existingByProduct
) {
  if (products.length === 0) {
    return {
      translated: 0,
      failed: 0,
      billedCharacters: 0,
    };
  }

  const EnglishResults =
    await translateTexts(
      products.map(
        (product) =>
          product.sourceName
      ),
      "en-GB"
    );

  const states =
    products.map(
      (product, index) => {
        const result =
          EnglishResults[index];

        const sourceLanguage =
          normalizeDetectedLanguage(
            result
              ?.detectedSourceLang
          );

        const translations =
          new Map();

        const providers =
          new Map();

        if (
          sourceLanguage === "en"
        ) {
          translations.set(
            "en",
            product.sourceName
          );

          providers.set(
            "en",
            "IMPORT"
          );

        } else {
          translations.set(
            "en",
            result.text
          );

          providers.set(
            "en",
            "DEEPL"
          );
        }

        return {
          product,
          sourceLanguage,
          translations,
          providers,

          manualTranslations:
            preserveManualTranslations(
              product,
              existingByProduct
            ),

          billedCharacters:
            Number(
              result
                ?.billedCharacters ||
              product
                .sourceName
                .length
            ),
        };
      }
    );

  for (
    const {
      languageCode,
      deeplCode,
    } of TARGETS
  ) {
    if (
      languageCode === "en"
    ) {
      continue;
    }

    const requiringTranslation =
      states.filter(
        (state) =>
          state.sourceLanguage
            !== languageCode
      );

    for (const state of states) {
      if (
        state.sourceLanguage ===
        languageCode
      ) {
        state.translations.set(
          languageCode,
          state.product
            .sourceName
        );

        state.providers.set(
          languageCode,
          "IMPORT"
        );
      }
    }

    const results =
      await translateTexts(
        requiringTranslation.map(
          (state) =>
            state.product
              .sourceName
        ),
        deeplCode
      );

    requiringTranslation.forEach(
      (state, index) => {
        const result =
          results[index];

        state.translations.set(
          languageCode,
          result.text
        );

        state.providers.set(
          languageCode,
          "DEEPL"
        );

        state.billedCharacters +=
          Number(
            result
              ?.billedCharacters ||
            state.product
              .sourceName
              .length
          );
      }
    );
  }

  let translated = 0;
  let failed = 0;
  let billedCharacters = 0;

  for (const state of states) {
    try {
      await saveProductTranslations(
        state
      );

      translated += 1;
      billedCharacters +=
        state.billedCharacters;

    } catch (error) {
      failed += 1;

      await AutomaticTranslationRepository
        .markFailed({
          productId:
            state.product
              .productId,

          errorMessage:
            error.message,

          attemptCount:
            state.product
              .attemptCount,
        });
    }
  }

  return {
    translated,
    failed,
    billedCharacters,
  };
}


function getMaxBatchesPerRun() {
  const parsed =
    Number(
      process.env
        .AUTO_TRANSLATION_MAX_BATCHES_PER_RUN
    );

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return 20;
  }

  return Math.min(parsed, 100);
}


export const AutomaticTranslationService = {
  isEnabled,


  async processQueue({
    source = "MANUAL",
  } = {}) {
    const totals = {
      status: "COMPLETED",
      source,
      batches: 0,
      claimed: 0,
      translated: 0,
      memoryHits: 0,
      failed: 0,
      billedCharacters: 0,
    };

    for (
      let index = 0;
      index <
        getMaxBatchesPerRun();
      index += 1
    ) {
      const result =
        await this.processPending({
          source,
        });

      if (
        result.status ===
        "DISABLED"
      ) {
        return {
          ...totals,
          status: "DISABLED",
        };
      }

      if (
        result.status ===
        "SKIPPED_ALREADY_RUNNING"
      ) {
        return {
          ...totals,
          status:
            totals.batches > 0
              ? "COMPLETED"
              : "SKIPPED_ALREADY_RUNNING",
        };
      }

      totals.batches += 1;
      totals.claimed +=
        result.claimed;
      totals.translated +=
        result.translated;
      totals.memoryHits +=
        result.memoryHits;
      totals.failed +=
        result.failed;
      totals.billedCharacters +=
        result.billedCharacters;

      if (
        result.claimed === 0
      ) {
        break;
      }
    }

    return totals;
  },


  async processPending({
    source = "MANUAL",
  } = {}) {
    if (!isEnabled()) {
      return {
        status: "DISABLED",
        source,
        claimed: 0,
        translated: 0,
        memoryHits: 0,
        failed: 0,
        billedCharacters: 0,
      };
    }

    const lock =
      await AutomaticTranslationRepository
        .acquireRunLock();

    if (!lock) {
      return {
        status:
          "SKIPPED_ALREADY_RUNNING",
        source,
        claimed: 0,
        translated: 0,
        memoryHits: 0,
        failed: 0,
        billedCharacters: 0,
      };
    }

    try {
      await AutomaticTranslationRepository
        .resetStaleProcessing();

      const products =
        await AutomaticTranslationRepository
          .claimJobs(
            getBatchSize()
          );

      if (
        products.length === 0
      ) {
        return {
          status: "COMPLETED",
          source,
          claimed: 0,
          translated: 0,
          memoryHits: 0,
          failed: 0,
          billedCharacters: 0,
        };
      }

      const existing =
        await AutomaticTranslationRepository
          .getExistingTranslations(
            products.map(
              (product) =>
                product.productId
            )
          );

      const existingByProduct =
        groupExistingTranslations(
          existing
        );

      const normalizedSources =
        products.map(
          (product) =>
            normalizeSourceText(
              product.sourceName
            )
        );

      const memoryRows =
        await AutomaticTranslationRepository
          .getMemoryByNormalizedSources(
            normalizedSources
          );

      const groupedMemory =
        groupMemory(
          memoryRows
        );

      const productsForDeepL = [];

      let memoryHits = 0;
      let failed = 0;

      for (const product of products) {
        const normalizedSource =
          normalizeSourceText(
            product.sourceName
          );

        const memory =
          findCompleteMemory(
            groupedMemory,
            normalizedSource
          );

        if (!memory) {
          productsForDeepL.push(
            product
          );
          continue;
        }

        try {
          await applyMemoryProduct({
            product,
            memory,

            manualTranslations:
              preserveManualTranslations(
                product,
                existingByProduct
              ),
          });

          memoryHits += 1;

        } catch (error) {
          failed += 1;

          await AutomaticTranslationRepository
            .markFailed({
              productId:
                product.productId,

              errorMessage:
                error.message,

              attemptCount:
                product.attemptCount,
            });
        }
      }

      let DeepLResult = {
        translated: 0,
        failed: 0,
        billedCharacters: 0,
      };

      if (
        productsForDeepL.length > 0
      ) {
        try {
          DeepLResult =
            await translateProducts(
              productsForDeepL,
              existingByProduct
            );

        } catch (error) {
          for (
            const product
            of productsForDeepL
          ) {
            await AutomaticTranslationRepository
              .markFailed({
                productId:
                  product.productId,

                errorMessage:
                  error.message,

                attemptCount:
                  product.attemptCount,
              });
          }

          DeepLResult.failed =
            productsForDeepL.length;
        }
      }

      return {
        status: "COMPLETED",
        source,
        claimed:
          products.length,

        translated:
          DeepLResult.translated,

        memoryHits,
        failed:
          failed +
          DeepLResult.failed,

        billedCharacters:
          DeepLResult
            .billedCharacters,
      };

    } finally {
      await AutomaticTranslationRepository
        .releaseRunLock(
          lock
        );
    }
  },


  async getStatus() {
    const status =
      await AutomaticTranslationRepository
        .getStatus();

    return {
      enabled:
        isEnabled(),

      provider:
        "DEEPL",

      keyConfigured:
        Boolean(
          String(
            process.env
              .DEEPL_AUTH_KEY ||
            ""
          ).trim()
        ),

      batchSize:
        getBatchSize(),

      maxBatchesPerRun:
        getMaxBatchesPerRun(),

      ...status,
    };
  },


  async retryFailed() {
    const requeued =
      await AutomaticTranslationRepository
        .requeueFailed();

    return {
      requeued,
    };
  },
};
