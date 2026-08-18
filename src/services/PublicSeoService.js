import { pool } from "../config/db.js";
import { normalizeArticle } from "./articleEngine/normalize.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { OfferService } from "./OfferService.js";
import { ProductCardService } from "./ProductCardService.js";
import { PublicSearchPresenterService } from "./PublicSearchPresenterService.js";
import { ProductPlaceholderService } from "./ProductPlaceholderService.js";

const PUBLIC_LOCALES = new Set(["uk", "en", "ru"]);

function publicLocale(value) {
  const locale = String(value || "").trim().toLowerCase();
  return PUBLIC_LOCALES.has(locale) ? locale : "uk";
}

function positivePage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function brandSlugPart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "brand";
}

export function publicBrandSlug(name, id) {
  return `${brandSlugPart(name)}-${Number(id)}`;
}

function brandIdFromSlug(value) {
  const match = String(value || "").match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function localizedTranslation(translations, locale) {
  return translations.find((item) => item.languageCode === locale)
    || translations.find((item) => item.languageCode === "uk")
    || translations[0]
    || null;
}

function localizedCategoryName(row, locale, prefix = "") {
  if (!row) return null;
  if (locale === "en") return row[`${prefix}name_en`] || row[`${prefix}name`];
  if (locale === "ru") return row[`${prefix}name_ru`] || row[`${prefix}name`];
  return row[`${prefix}name_uk`] || row[`${prefix}name`];
}

function mapPublicOffer(offer) {
  return {
    id: Number(offer.id),
    price: Number(offer.retailPrice),
    quantity: Number(offer.quantity),
    displayQuantity: offer.displayQuantity || String(offer.quantity),
    sourceLabel: offer.sourceLabel || null,
    deliveryDays: Number(offer.deliveryDays) || 0,
    availabilityText: offer.availabilityText,
    isAvailable: offer.isAvailable === true,
    isReturnable: offer.isReturnable !== false,
  };
}

function mapRelatedProduct(item) {
  return {
    article: item.product.article,
    name: item.product.name || null,
    manufacturer: item.product.manufacturer || null,
  };
}

function mergeRelatedProducts(items, links) {
  const related = new Map();
  for (const item of items || []) {
    const mapped = mapRelatedProduct(item);
    related.set(normalizeArticle(mapped.article), mapped);
  }
  for (const link of links || []) {
    const key = normalizeArticle(link.article);
    if (!key || related.has(key)) continue;
    related.set(key, {
      article: link.article,
      name: null,
      manufacturer: link.manufacturer || null,
    });
  }
  return [...related.values()];
}

export const PublicSeoService = {
  async getProduct({ article, locale: requestedLocale }, db = pool) {
    const normalized = normalizeArticle(article);
    if (!normalized) return null;

    const productResult = await db.query(`
      SELECT
        p.id,
        p.brand_id,
        b.id AS catalog_brand_id,
        b.name AS catalog_brand_name,
        p.article,
        p.article_normalized,
        p.article_no_prefix,
        p.name,
        p.updated_at,
        vb.name AS vehicle_brand,
        COALESCE(b.name, pm.name) AS manufacturer,
        pt.name AS product_type
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN vehicle_brands vb ON vb.id = p.vehicle_brand_id
      LEFT JOIN part_manufacturers pm ON pm.id = p.manufacturer_id
      LEFT JOIN product_types pt ON pt.id = p.product_type_id
      WHERE p.is_active = TRUE
        AND (
          p.article_normalized = $1
          OR UPPER(REGEXP_REPLACE(p.article, '[^A-Za-z0-9]', '', 'g')) = $1
        )
      ORDER BY
        CASE WHEN p.article_normalized = $1 THEN 0 ELSE 1 END,
        p.id
      LIMIT 1
    `, [normalized]);

    const product = productResult.rows[0];
    if (!product) return null;

    const locale = publicLocale(requestedLocale);
    const [pricingContext, translationsResult, categoryResult, articleLinksResult] = await Promise.all([
      CustomerPricingService.getContext(null, db),
      db.query(`
        SELECT language_code, name, description
        FROM product_translations
        WHERE product_id = $1
          AND language_code = ANY($2::varchar[])
        ORDER BY language_code
      `, [product.id, [...PUBLIC_LOCALES]]),
      db.query(`
        SELECT
          c.id,
          c.slug,
          c.name,
          c.name_uk,
          c.name_ru,
          c.name_en,
          parent.id AS parent_id,
          parent.slug AS parent_slug,
          parent.name AS parent_name,
          parent.name_uk AS parent_name_uk,
          parent.name_ru AS parent_name_ru,
          parent.name_en AS parent_name_en
        FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id AND c.is_active = TRUE
        LEFT JOIN categories parent ON parent.id = c.parent_id AND parent.is_active = TRUE
        WHERE pc.product_id = $1
          AND (
            pc.assignment_source = 'MANUAL'
            OR NOT EXISTS (
              SELECT 1
              FROM product_categories manual_pc
              WHERE manual_pc.product_id = pc.product_id
                AND manual_pc.assignment_source = 'MANUAL'
            )
          )
        ORDER BY
          CASE WHEN pc.assignment_source = 'MANUAL' THEN 0 ELSE 1 END,
          (c.parent_id IS NOT NULL) DESC,
          pc.confidence DESC NULLS LAST,
          c.sort_order,
          c.id
        LIMIT 1
      `, [product.id]),
      db.query(`
        SELECT
          links.link_type,
          CASE
            WHEN links.source_brand_id = $1
              AND links.source_article_normalized = $2
            THEN links.target_article
            ELSE links.source_article
          END AS article,
          CASE
            WHEN links.source_brand_id = $1
              AND links.source_article_normalized = $2
            THEN target_brand.name
            ELSE source_brand.name
          END AS manufacturer
        FROM article_number_links links
        JOIN brands source_brand ON source_brand.id = links.source_brand_id
        JOIN brands target_brand ON target_brand.id = links.target_brand_id
        WHERE links.is_active = TRUE
          AND (
            (links.source_brand_id = $1 AND links.source_article_normalized = $2)
            OR (links.target_brand_id = $1 AND links.target_article_normalized = $2)
          )
        ORDER BY links.link_type, links.id
      `, [product.brand_id, product.article_normalized]),
    ]);

    const card = await ProductCardService.build(product, pricingContext);
    const presented = await PublicSearchPresenterService.present({
      requestedLocale: locale,
      family: [],
      productCard: card,
    });
    const publicCard = presented.productCard;
    if (!publicCard) return null;

    const translations = translationsResult.rows.map((row) => ({
      languageCode: row.language_code,
      name: row.name,
      description: row.description || null,
    }));
    const selectedTranslation = localizedTranslation(translations, locale);
    const availableOffers = publicCard.offers
      .filter((offer) => offer.isAvailable && Number.isFinite(Number(offer.retailPrice)))
      .sort((first, second) => Number(first.retailPrice) - Number(second.retailPrice));
    const linkedByType = (type) => articleLinksResult.rows.filter((item) => item.link_type === type);
    const analogs = mergeRelatedProducts(publicCard.analogs, linkedByType("ANALOG"));
    const replacements = mergeRelatedProducts(publicCard.replacements, linkedByType("REPLACEMENT"));
    const category = categoryResult.rows[0];
    const alternativeArticles = [
      product.article_no_prefix,
      ...linkedByType("ALIAS").map((item) => item.article),
    ].filter((value, index, values) => {
      const normalizedValue = normalizeArticle(value);
      return normalizedValue
        && normalizedValue !== normalizeArticle(publicCard.product.article)
        && values.findIndex((candidate) => normalizeArticle(candidate) === normalizedValue) === index;
    });

    return {
      locale,
      product: {
        id: Number(publicCard.product.id),
        article: publicCard.product.article,
        normalizedArticle: publicCard.product.article_normalized,
        name: publicCard.product.name,
        description: selectedTranslation?.description || null,
        manufacturer: publicCard.product.manufacturer || null,
        brandPageSlug: product.catalog_brand_id
          ? publicBrandSlug(product.catalog_brand_name, product.catalog_brand_id)
          : null,
        vehicleBrand: publicCard.product.vehicle_brand || null,
        productType: publicCard.product.product_type || null,
        category: category ? {
          id: Number(category.id),
          slug: category.slug,
          name: localizedCategoryName(category, locale),
          parent: category.parent_id ? {
            id: Number(category.parent_id),
            slug: category.parent_slug,
            name: localizedCategoryName(category, locale, "parent_"),
          } : null,
        } : null,
        images: publicCard.product.imageUrls || [],
        placeholderImageUrl: ProductPlaceholderService.productPlaceholderUrl(publicCard.product),
        hasRealImage: publicCard.product.hasRealImage === true,
        alternateNames: [...new Set(
          translations
            .map((item) => item.name)
            .filter((name) => name && name !== publicCard.product.name)
        )],
        translations,
        updatedAt: product.updated_at || null,
      },
      alternativeArticles,
      analogs,
      replacements,
      analogArticles: analogs.map((item) => item.article),
      replacementArticles: replacements.map((item) => item.article),
      relatedArticles: [...new Set(
        [...analogs, ...replacements].map((item) => item.article).filter(Boolean)
      )],
      offers: availableOffers.map(mapPublicOffer),
      offer: availableOffers[0] ? mapPublicOffer(availableOffers[0]) : null,
    };
  },

  async getSitemap(db = pool) {
    const [productsResult, categoriesResult, brandsResult, languagesResult] = await Promise.all([
      db.query(`
        SELECT
          p.article,
          p.updated_at,
          (SELECT pi.url FROM product_images pi
           WHERE pi.product_id = p.id
           ORDER BY pi.priority, pi.id
           LIMIT 1) AS image_url
        FROM products p
        WHERE p.is_active = TRUE
        ORDER BY p.id
      `),
      db.query(`
        SELECT c.slug
        FROM categories c
        WHERE c.is_active = TRUE
        ORDER BY c.id
      `),
      db.query(`
        SELECT b.id, b.name, b.updated_at
        FROM brands b
        WHERE b.is_active = TRUE
          AND EXISTS (
            SELECT 1 FROM products p
            WHERE p.brand_id = b.id AND p.is_active = TRUE
          )
        ORDER BY b.id
      `),
      db.query(`
        SELECT code
        FROM site_languages
        WHERE is_public_enabled = TRUE
          AND code = ANY($1::varchar[])
        ORDER BY sort_order, code
      `, [[...PUBLIC_LOCALES]]),
    ]);

    return {
      languages: languagesResult.rows.map((row) => row.code),
      products: productsResult.rows.map((row) => ({
        article: row.article,
        updatedAt: row.updated_at || null,
        imageUrl: row.image_url || null,
      })),
      categories: categoriesResult.rows.map((row) => ({ slug: row.slug })),
      brands: brandsResult.rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        slug: publicBrandSlug(row.name, row.id),
        updatedAt: row.updated_at || null,
      })),
    };
  },

  async getBrand({ slug, locale: requestedLocale, page: requestedPage }, db = pool) {
    const brandId = brandIdFromSlug(slug);
    if (!brandId) return null;

    const brandResult = await db.query(`
      SELECT b.id, b.name, b.updated_at
      FROM brands b
      WHERE b.id = $1 AND b.is_active = TRUE
      LIMIT 1
    `, [brandId]);
    const brand = brandResult.rows[0];
    if (!brand || publicBrandSlug(brand.name, brand.id) !== slug) return null;

    const locale = publicLocale(requestedLocale);
    const page = positivePage(requestedPage);
    const pageSize = 24;
    const [countResult, productsResult, pricingContext] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::integer AS count
        FROM products p
        WHERE p.brand_id = $1 AND p.is_active = TRUE
      `, [brandId]),
      db.query(`
        SELECT
          p.id,
          p.article,
          COALESCE(requested_translation.name, default_translation.name, p.name) AS name,
          image.url AS image_url
        FROM products p
        LEFT JOIN product_translations requested_translation
          ON requested_translation.product_id = p.id
          AND requested_translation.language_code = $2
        LEFT JOIN LATERAL (
          SELECT sl.code
          FROM site_languages sl
          WHERE sl.is_public_enabled = TRUE AND sl.is_default = TRUE
          ORDER BY sl.sort_order, sl.code
          LIMIT 1
        ) default_language ON TRUE
        LEFT JOIN product_translations default_translation
          ON default_translation.product_id = p.id
          AND default_translation.language_code = default_language.code
        LEFT JOIN LATERAL (
          SELECT pi.url
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.priority, pi.id
          LIMIT 1
        ) image ON TRUE
        WHERE p.brand_id = $1 AND p.is_active = TRUE
        ORDER BY CASE WHEN image.url IS NULL THEN 1 ELSE 0 END, p.article, p.id
        LIMIT $3 OFFSET $4
      `, [brandId, locale, pageSize, (page - 1) * pageSize]),
      CustomerPricingService.getContext(null, db),
    ]);

    const products = await Promise.all(productsResult.rows.map(async (product) => {
      const offers = await OfferService.getOffersByProductId(product.id, pricingContext, locale);
      const offer = offers
        .filter((item) => item.isAvailable && Number.isFinite(Number(item.retailPrice)))
        .sort((first, second) => Number(first.retailPrice) - Number(second.retailPrice))[0];
      const image = ProductPlaceholderService.getProductImage({
        ...product,
        imageUrl: product.image_url,
      });
      return {
        id: Number(product.id),
        article: product.article,
        name: product.name,
        imageUrl: image.imageUrl,
        hasRealImage: image.hasRealImage,
        isPlaceholder: image.isPlaceholder,
        offer: offer ? mapPublicOffer(offer) : null,
      };
    }));
    const total = Number(countResult.rows[0]?.count || 0);

    return {
      locale,
      brand: {
        id: Number(brand.id),
        name: brand.name,
        slug,
        updatedAt: brand.updated_at || null,
      },
      products,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  },
};
