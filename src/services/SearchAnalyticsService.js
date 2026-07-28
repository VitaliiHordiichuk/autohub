import {
  createHash,
} from "node:crypto";

import {
  SearchAnalyticsRepository,
} from "../repositories/SearchAnalyticsRepository.js";


function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}


function cleanText(
  value,
  maxLength
) {
  const text = String(
    value ?? ""
  ).trim();

  if (!text) {
    return null;
  }

  return text.slice(
    0,
    maxLength
  );
}


function decodeHeader(value) {
  const text = cleanText(
    firstHeaderValue(value),
    300
  );

  if (!text) {
    return null;
  }

  try {
    return decodeURIComponent(
      text
    );
  } catch {
    return text;
  }
}


function requestHeaders(req) {
  return req?.headers ?? {};
}


function resolveSessionId(req) {
  const headers =
    requestHeaders(req);

  const value = cleanText(
    headers[
      "x-analytics-session"
    ],
    100
  );

  if (!value) {
    return null;
  }

  return /^[A-Za-z0-9._:-]+$/.test(
    value
  )
    ? value
    : null;
}


function resolveCity(req) {
  const headers =
    requestHeaders(req);

  return (
    decodeHeader(
      headers[
        "x-vercel-ip-city"
      ]
    ) ||
    decodeHeader(
      headers.cfipcity
    ) ||
    decodeHeader(
      headers[
        "x-client-city"
      ]
    ) ||
    null
  );
}


function resolveCountryCode(req) {
  const headers =
    requestHeaders(req);

  return cleanText(
    headers[
      "x-vercel-ip-country"
    ] ||
      headers.cfipcountry ||
      headers[
        "x-client-country"
      ],
    10
  );
}


function resolveClientIp(req) {
  const headers =
    requestHeaders(req);

  const forwarded =
    cleanText(
      headers[
        "x-forwarded-for"
      ],
      500
    );

  if (forwarded) {
    return cleanText(
      forwarded.split(",")[0],
      100
    );
  }

  return cleanText(
    req?.socket?.remoteAddress,
    100
  );
}


function hashIp(value) {
  if (!value) {
    return null;
  }

  const salt =
    process.env
      .SEARCH_ANALYTICS_HASH_SECRET ||
    process.env.AUTH_JWT_SECRET ||
    "autohub-search-analytics";

  return createHash("sha256")
    .update(
      `${salt}:${value}`
    )
    .digest("hex");
}


function finiteNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : null;
}


function collectResults(
  publicResult
) {
  const results = [];
  const seen = new Set();

  function addProduct(
    product,
    offers,
    relationType
  ) {
    if (!product) {
      return;
    }

    const normalizedOffers =
      Array.isArray(offers)
        ? offers
        : [];

    const rows =
      normalizedOffers.length > 0
        ? normalizedOffers
        : [null];

    for (const offer of rows) {
      const key = [
        relationType,
        product.id ?? "",
        offer?.id ?? "",
      ].join(":");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      results.push({
        productId:
          Number.isInteger(
            Number(product.id)
          )
            ? Number(product.id)
            : null,

        productOfferId:
          offer &&
          Number.isInteger(
            Number(offer.id)
          )
            ? Number(offer.id)
            : null,

        relationType,

        article:
          cleanText(
            product.article,
            100
          ),

        productName:
          cleanText(
            product.name,
            255
          ),

        retailPrice:
          finiteNumber(
            offer?.retailPrice
          ),

        quantity:
          finiteNumber(
            offer?.quantity
          ),

        sourceType:
          cleanText(
            offer?.sourceType,
            50
          ),

        sortPosition:
          results.length,
      });
    }
  }

  const productCard =
    publicResult?.productCard;

  if (productCard) {
    addProduct(
      productCard.product,
      productCard.offers,
      "EXACT"
    );

    for (
      const item of
        productCard.analogs || []
    ) {
      addProduct(
        item.product,
        item.offers,
        "ANALOG"
      );
    }

    for (
      const item of
        productCard.replacements || []
    ) {
      addProduct(
        item.product,
        item.offers,
        "REPLACEMENT"
      );
    }
  }

  for (
    const item of
      publicResult?.family || []
  ) {
    addProduct(
      item.product ?? item,
      item.offers,
      "FAMILY"
    );
  }

  return results;
}


export const SearchAnalyticsService = {
  async recordSearch({
    req,
    article,
    searchResult,
    publicResult = null,
    requestedLocale = null,
  }) {
    try {
      const results =
        collectResults(
          publicResult
        );

      const productIds =
        new Set(
          results
            .map(
              (result) =>
                result.productId
            )
            .filter(Boolean)
        );

      const offersCount =
        results.filter(
          (result) =>
            result.productOfferId !==
            null
        ).length;

      return await SearchAnalyticsRepository
        .createSearchEvent({
          visitorSessionId:
            resolveSessionId(req),

          userId:
            req?.auth?.userId ??
            null,

          rawQuery:
            cleanText(
              article,
              255
            ) || "",

          normalizedQuery:
            cleanText(
              searchResult
                .normalized,
              255
            ),

          searchedArticle:
            cleanText(
              searchResult
                .searchedArticle ??
                searchResult
                  .normalized,
              255
            ),

          searchRule:
            cleanText(
              searchResult.rule,
              50
            ),

          locale:
            cleanText(
              publicResult?.locale ??
                requestedLocale,
              10
            ),

          found:
            searchResult.found ===
            true,

          exactProductId:
            searchResult
              .exactProduct?.id ??
            null,

          resultProductsCount:
            productIds.size,

          resultOffersCount:
            offersCount,

          city:
            resolveCity(req),

          countryCode:
            resolveCountryCode(req),

          ipHash:
            hashIp(
              resolveClientIp(req)
            ),

          userAgent:
            cleanText(
              requestHeaders(req)[
                "user-agent"
              ],
              1000
            ),

          results,
        });
    } catch (error) {
      console.error(
        "Ошибка записи поисковой аналитики:",
        error.message
      );

      return null;
    }
  },
};
