const RESPONSIVE_WIDTHS = [400, 800, 1200, 1500];

function cleanUrl(value) {
  const url = String(value || "").trim();
  return url || null;
}

function safeAlias(value) {
  const alias = String(value || "pi");
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new TypeError("Invalid SQL alias for a public product image");
  }
  return alias;
}

// Only expose site/branded variants while the corresponding processed image is
// selected for display. ORIGINAL mode and legacy rows keep their existing URL.
function sql(alias = "pi") {
  const image = safeAlias(alias);
  return `JSON_BUILD_OBJECT(
    'url', ${image}.url,
    'variants', CASE
      WHEN ${image}.display_mode = 'PROCESSED'
        AND ${image}.processed_url_1600 IS NOT NULL
      THEN JSON_BUILD_ARRAY(
        JSON_BUILD_OBJECT('width', 400, 'url', ${image}.processed_url_400),
        JSON_BUILD_OBJECT('width', 800, 'url', ${image}.processed_url_800),
        JSON_BUILD_OBJECT('width', 1200, 'url', ${image}.processed_url_1200),
        JSON_BUILD_OBJECT('width', 1500, 'url', ${image}.processed_url_1600)
      )
      ELSE '[]'::json
    END
  )`;
}

function normalize(value) {
  if (!value || typeof value !== "object") return null;
  const url = cleanUrl(value.url);
  if (!url) return null;

  const byWidth = new Map();
  for (const candidate of Array.isArray(value.variants) ? value.variants : []) {
    const width = Number(candidate?.width);
    const candidateUrl = cleanUrl(candidate?.url);
    if (!RESPONSIVE_WIDTHS.includes(width) || !candidateUrl) continue;
    byWidth.set(width, candidateUrl);
  }

  return {
    url,
    variants: [...byWidth.entries()]
      .sort(([first], [second]) => first - second)
      .map(([width, candidateUrl]) => ({ width, url: candidateUrl })),
  };
}

function normalizeMany(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalize).filter(Boolean);
}

export const PublicProductImageService = {
  normalize,
  normalizeMany,
  sql,
};
