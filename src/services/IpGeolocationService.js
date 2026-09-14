import { isIP } from "node:net";


const DEFAULT_TIMEOUT_MS = 700;
const POSITIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;


function cleanText(value, maxLength) {
  const text = String(value ?? "").trim();

  if (!text || text === "-") {
    return null;
  }

  return text.slice(0, maxLength);
}


function configuredTimeout(value) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < 100 || numeric > 3000) {
    return DEFAULT_TIMEOUT_MS;
  }

  return numeric;
}


function isPublicIpv4(ip) {
  const octets = ip.split(".").map(Number);

  if (octets.length !== 4 || octets.some((value) => value < 0 || value > 255)) {
    return false;
  }

  const [first, second, third] = octets;

  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}


function isPublicIpv6(ip) {
  const normalized = ip.toLowerCase();

  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}


export function isPublicIpAddress(value) {
  const ip = cleanText(value, 100);
  const version = isIP(ip || "");

  if (version === 4) {
    return isPublicIpv4(ip);
  }

  if (version === 6) {
    return isPublicIpv6(ip);
  }

  return false;
}


function normalizeResponse(data) {
  const city = cleanText(
    data?.city_name ?? data?.city?.name ?? data?.city,
    150
  );

  const countryCode = cleanText(
    data?.country_code ?? data?.countryCode ?? data?.country,
    10
  )?.toUpperCase() || null;

  if (!city && !countryCode) {
    return null;
  }

  return {
    city,
    countryCode,
  };
}


function setBoundedCache(cache, key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  cache.set(key, value);
}


export function createIpGeolocationService({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  apiKey,
  enabled,
  timeoutMs,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function requestLocation(ip) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      configuredTimeout(timeoutMs ?? process.env.IP_GEOLOCATION_TIMEOUT_MS)
    );

    try {
      const headers = {
        Accept: "application/json",
      };

      const configuredApiKey = cleanText(
        apiKey ?? process.env.IP2LOCATION_API_KEY,
        500
      );

      if (configuredApiKey) {
        headers.Authorization = `Bearer ${configuredApiKey}`;
      }

      const url = new URL("https://api.ip2location.io/");
      url.searchParams.set("ip", ip);
      url.searchParams.set("format", "json");

      const response = await fetchImpl(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      return normalizeResponse(await response.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async lookup(ipValue) {
      const ip = cleanText(ipValue, 100);
      const isEnabled = String(
        enabled ?? process.env.IP_GEOLOCATION_ENABLED ?? "true"
      ).toLowerCase() !== "false";

      if (!isEnabled || !isPublicIpAddress(ip)) {
        return null;
      }

      const cached = cache.get(ip);

      if (cached && cached.expiresAt > now()) {
        return cached.value;
      }

      if (cached) {
        cache.delete(ip);
      }

      if (inFlight.has(ip)) {
        return inFlight.get(ip);
      }

      const request = requestLocation(ip)
        .then((value) => {
          setBoundedCache(cache, ip, {
            value,
            expiresAt:
              now() + (value ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
          });

          return value;
        })
        .finally(() => {
          inFlight.delete(ip);
        });

      inFlight.set(ip, request);
      return request;
    },

    clearCache() {
      cache.clear();
      inFlight.clear();
    },
  };
}


export const IpGeolocationService = createIpGeolocationService();
