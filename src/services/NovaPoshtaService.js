const DEFAULT_API_URL =
  "https://api.novaposhta.ua/v2.0/json/";

const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizedText(value, maxLength = 100) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function cityLabel(city) {
  const details = [
    normalizedText(city.SettlementTypeDescription, 60),
    normalizedText(city.AreaDescription, 120),
  ].filter(Boolean);

  return details.length
    ? `${normalizedText(city.Description, 160)} (${details.join(", ")})`
    : normalizedText(city.Description, 160);
}

function pointType(point) {
  const category = normalizedText(
    point.CategoryOfWarehouse,
    60
  ).toLowerCase();
  const description = normalizedText(
    point.Description,
    255
  ).toLowerCase();

  return category.includes("postomat") ||
    description.includes("поштомат") ||
    description.includes("почтомат")
    ? "LOCKER"
    : "BRANCH";
}

function freshCacheValue(cache, key) {
  const cached = cache.get(key);

  if (!cached || cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function saveCacheValue(cache, key, value) {
  if (cache.size >= 500 && !cache.has(key)) {
    cache.delete(cache.keys().next().value);
  }

  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return value;
}

export function createNovaPoshtaService({
  apiKey = null,
  apiUrl = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const cache = new Map();

  function configuredApiKey() {
    return normalizedText(
      apiKey ?? process.env.NOVA_POSHTA_API_KEY,
      200
    );
  }

  async function callApi(modelName, calledMethod, methodProperties) {
    const key = configuredApiKey();

    if (!key) {
      throw serviceError(
        "Сервіс Нової пошти ще не налаштовано",
        503,
        "NOVA_POSHTA_NOT_CONFIGURED"
      );
    }

    if (typeof fetchImpl !== "function") {
      throw serviceError(
        "Сервіс Нової пошти тимчасово недоступний",
        503,
        "NOVA_POSHTA_UNAVAILABLE"
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetchImpl(
        apiUrl || process.env.NOVA_POSHTA_API_URL || DEFAULT_API_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            apiKey: key,
            modelName,
            calledMethod,
            methodProperties,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw serviceError(
          "Нова пошта не відповіла на запит",
          502,
          "NOVA_POSHTA_UPSTREAM_ERROR"
        );
      }

      const payload = await response.json();

      if (!payload?.success) {
        const providerMessage = Array.isArray(payload?.errors)
          ? payload.errors.filter(Boolean).join(". ")
          : "";
        const error = serviceError(
          "Не вдалося отримати довідник Нової пошти",
          502,
          "NOVA_POSHTA_UPSTREAM_ERROR"
        );
        error.providerMessage = providerMessage;
        throw error;
      }

      return Array.isArray(payload.data) ? payload.data : [];
    } catch (error) {
      if (error?.code?.startsWith("NOVA_POSHTA_")) {
        throw error;
      }

      throw serviceError(
        error?.name === "AbortError"
          ? "Нова пошта не відповіла вчасно"
          : "Сервіс Нової пошти тимчасово недоступний",
        503,
        "NOVA_POSHTA_UNAVAILABLE"
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async function searchCities(query, { locale = "uk" } = {}) {
    const normalizedQuery = normalizedText(query, 100);

    if (normalizedQuery.length < 2) {
      return [];
    }

    const normalizedLocale = locale === "ru" ? "ru" : "uk";
    const cacheKey = `cities:${normalizedLocale}:${normalizedQuery.toLowerCase()}`;
    const cached = freshCacheValue(cache, cacheKey);
    if (cached) return cached;

    const rows = await callApi("Address", "getCities", {
      FindByString: normalizedQuery,
      Limit: "30",
      Page: "1",
    });
    const seen = new Set();
    const cities = [];

    for (const row of rows) {
      const ref = normalizedText(row.Ref, 100);
      const ukrainianName = normalizedText(row.Description, 160);
      const localizedName = normalizedLocale === "ru"
        ? normalizedText(row.DescriptionRu, 160) || ukrainianName
        : ukrainianName;

      if (!ref || !localizedName || seen.has(ref)) continue;
      seen.add(ref);

      const localizedRow = {
        ...row,
        Description: localizedName,
        AreaDescription:
          normalizedLocale === "ru"
            ? normalizedText(row.AreaDescriptionRu, 120) ||
              normalizedText(row.AreaDescription, 120)
            : normalizedText(row.AreaDescription, 120),
        SettlementTypeDescription:
          normalizedLocale === "ru"
            ? normalizedText(row.SettlementTypeDescriptionRu, 60) ||
              normalizedText(row.SettlementTypeDescription, 60)
            : normalizedText(row.SettlementTypeDescription, 60),
      };

      cities.push({
        ref,
        name: localizedName,
        displayName: cityLabel(localizedRow),
        area: localizedRow.AreaDescription || null,
        settlementType:
          localizedRow.SettlementTypeDescription || null,
      });
    }

    return saveCacheValue(cache, cacheKey, cities);
  }

  async function searchPoints(cityRef, query = "", { locale = "uk" } = {}) {
    const normalizedCityRef = normalizedText(cityRef, 100);
    const normalizedQuery = normalizedText(query, 100);

    if (!normalizedCityRef) {
      throw serviceError(
        "Спочатку оберіть місто",
        400,
        "NOVA_POSHTA_CITY_REQUIRED"
      );
    }

    const normalizedLocale = locale === "ru" ? "ru" : "uk";
    const cacheKey = `points:${normalizedLocale}:${normalizedCityRef}:${normalizedQuery.toLowerCase()}`;
    const cached = freshCacheValue(cache, cacheKey);
    if (cached) return cached;

    const methodProperties = {
      CityRef: normalizedCityRef,
      Limit: "50",
      Page: "1",
    };
    if (normalizedQuery) {
      methodProperties.FindByString = normalizedQuery;
    }

    const rows = await callApi(
      "Address",
      "getWarehouses",
      methodProperties
    );
    const seen = new Set();
    const points = [];

    for (const row of rows) {
      const ref = normalizedText(row.Ref, 100);
      const ukrainianName = normalizedText(row.Description, 255);
      const name = normalizedLocale === "ru"
        ? normalizedText(row.DescriptionRu, 255) || ukrainianName
        : ukrainianName;

      if (!ref || !name || seen.has(ref)) continue;
      seen.add(ref);

      const ukrainianAddress = normalizedText(row.ShortAddress, 255);
      const address = normalizedLocale === "ru"
        ? normalizedText(row.ShortAddressRu, 255) || ukrainianAddress
        : ukrainianAddress;

      points.push({
        ref,
        type: pointType(row),
        number: normalizedText(row.Number, 50) || null,
        name,
        address: address || null,
        postalCode:
          normalizedText(row.PostalCodeUA, 20) || null,
      });
    }

    return saveCacheValue(cache, cacheKey, points);
  }

  return {
    searchCities,
    searchPoints,
  };
}

export const NovaPoshtaService =
  createNovaPoshtaService();
