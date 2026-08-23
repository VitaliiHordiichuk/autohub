import {
  createHash,
} from "node:crypto";

import geoip from "geoip-lite";

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
      headers["cf-ipcity"] ||
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
        "cf-ipcountry"
      ] ||
      headers[
        "x-client-country"
      ],
    10
  );
}


function resolveClientIp(req) {
  const headers =
    requestHeaders(req);

  for (const headerName of [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
  ]) {
    const value = cleanText(
      firstHeaderValue(
        headers[headerName]
      ),
      100
    );

    if (value) {
      return value;
    }
  }

  const proxyResolved =
    cleanText(
      req?.ip,
      100
    );

  if (proxyResolved) {
    return proxyResolved;
  }

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


function normalizeClientIp(value) {
  let ip = cleanText(
    value,
    100
  );

  if (!ip) {
    return null;
  }

  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  if (
    ip.startsWith("[") &&
    ip.includes("]")
  ) {
    ip = ip.slice(
      1,
      ip.indexOf("]")
    );
  } else if (
    /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)
  ) {
    ip = ip.replace(/:\d+$/, "");
  }

  return ip;
}


export function resolveSearchLocation(req) {
  const clientIp = normalizeClientIp(
    resolveClientIp(req)
  );

  const location = clientIp
    ? geoip.lookup(clientIp)
    : null;

  return {
    clientIp,

    city:
      resolveCity(req) ||
      cleanText(
        location?.city,
        150
      ),

    countryCode:
      (
        resolveCountryCode(req) ||
        cleanText(
          location?.country,
          10
        )
      )?.toUpperCase() || null,
  };
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
  sourceResult
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

        supplierName:
          cleanText(
            offer?.supplier?.name,
            255
          ),

        warehouseName:
          cleanText(
            offer?.warehouse?.name,
            255
          ),

        sortPosition:
          results.length,
      });
    }
  }

  const productCard =
    sourceResult?.productCard;

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
      sourceResult?.family || []
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
    analyticsResult = null,
    requestedLocale = null,
  }) {
    try {
      const location =
        resolveSearchLocation(req);

      const results =
        collectResults(
          analyticsResult ||
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
            location.city,

          countryCode:
            location.countryCode,

          ipHash:
            hashIp(
              location.clientIp
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
