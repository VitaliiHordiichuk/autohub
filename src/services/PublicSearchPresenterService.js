import {
  pool,
} from "../config/db.js";


const PUBLIC_TEXT = {
  uk: {
    ownStock:
      "Наш склад",

    partnerStock:
      "Доступно під замовлення",

    ownAvailable:
      "Є сьогодні",

    orderAvailable:
      "Під замовлення",

    unavailable:
      "Немає в наявності",
  },

  en: {
    ownStock:
      "Our stock",

    partnerStock:
      "Available to order",

    ownAvailable:
      "Available today",

    orderAvailable:
      "On order",

    unavailable:
      "Out of stock",
  },

  ru: {
    ownStock:
      "Наш склад",

    partnerStock:
      "Доступно под заказ",

    ownAvailable:
      "Есть сегодня",

    orderAvailable:
      "Под заказ",

    unavailable:
      "Нет в наличии",
  },
};


function normalizeLocale(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


async function resolvePublicLocale(
  requestedLocale
) {
  const result =
    await pool.query(
      `
        SELECT
          code
        FROM site_languages
        WHERE is_public_enabled = TRUE
        ORDER BY
          CASE
            WHEN code = $1
            THEN 0

            WHEN is_default = TRUE
            THEN 1

            ELSE 2
          END,

          sort_order ASC,
          code ASC
        LIMIT 1;
      `,
      [
        normalizeLocale(
          requestedLocale
        ),
      ]
    );

  return (
    result.rows[0]?.code ||
    "uk"
  );
}


async function loadPublicNames(
  productIds,
  locale
) {
  const uniqueIds = [
    ...new Set(
      productIds
        .map(Number)
        .filter(
          (id) =>
            Number.isInteger(id) &&
            id > 0
        )
    ),
  ];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const result =
    await pool.query(
      `
        SELECT
          p.id,

          COALESCE(
            requested_translation.name,
            default_translation.name,
            p.name
          ) AS public_name,

          CASE
            WHEN
              requested_translation.name
              IS NOT NULL
            THEN $2

            WHEN
              default_translation.name
              IS NOT NULL
            THEN default_language.code

            ELSE NULL
          END AS translation_locale,

          ARRAY(
            SELECT pi.url
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.priority, pi.id
          ) AS image_urls

        FROM products p

        LEFT JOIN
          product_translations
          requested_translation
          ON
            requested_translation.product_id =
              p.id
            AND
            requested_translation.language_code =
              $2

        LEFT JOIN LATERAL (
          SELECT
            code
          FROM site_languages
          WHERE
            is_public_enabled = TRUE
            AND is_default = TRUE
          ORDER BY
            sort_order ASC,
            code ASC
          LIMIT 1
        ) default_language
          ON TRUE

        LEFT JOIN
          product_translations
          default_translation
          ON
            default_translation.product_id =
              p.id
            AND
            default_translation.language_code =
              default_language.code

        WHERE
          p.id =
            ANY($1::bigint[]);
      `,
      [
        uniqueIds,
        locale,
      ]
    );

  return new Map(
    result.rows.map(
      (row) => [
        Number(row.id),

        {
          name:
            row.public_name,

          translationLocale:
            row.translation_locale ??
            null,
          imageUrls:
            row.image_urls ??
            [],
        },
      ]
    )
  );
}


function collectProductIds(
  family,
  productCard
) {
  const ids = [];

  for (const item of family || []) {
    const product =
      item?.product ?? item;

    if (product?.id) {
      ids.push(product.id);
    }
  }

  if (productCard?.product) {
    ids.push(
      productCard.product.id
    );
  }

  for (
    const related of
      productCard?.analogs || []
  ) {
    if (related.product) {
      ids.push(
        related.product.id
      );
    }
  }

  for (
    const related of
      productCard?.replacements || []
  ) {
    if (related.product) {
      ids.push(
        related.product.id
      );
    }
  }

  return ids;
}


function localizeProduct(
  product,
  names
) {
  if (!product) {
    return null;
  }

  const localized =
    names.get(
      Number(product.id)
    );

  return {
    ...product,

    name:
      localized?.name ??
      product.name,

    translationLocale:
      localized?.translationLocale ??
      null,

    imageUrl:
      localized?.imageUrls?.[0] ??
      null,

    imageUrls:
      localized?.imageUrls ??
      [],
  };
}


function formatQuantity(
  value
) {
  const quantity =
    Number(value);

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return 0;
  }

  return quantity;
}


function formatPrice(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const price =
    Number(value);

  if (!Number.isFinite(price)) {
    return null;
  }

  return Number(
    price.toFixed(2)
  );
}


function formatUkrainianDays(
  days
) {
  const lastTwo =
    days % 100;

  const last =
    days % 10;

  if (
    lastTwo >= 11 &&
    lastTwo <= 14
  ) {
    return `${days} днів`;
  }

  if (last === 1) {
    return `${days} день`;
  }

  if (
    last >= 2 &&
    last <= 4
  ) {
    return `${days} дні`;
  }

  return `${days} днів`;
}


function formatRussianDays(days) {
  const lastTwo = days % 100;
  const last = days % 10;

  if (lastTwo >= 11 && lastTwo <= 14) {
    return `${days} дней`;
  }

  if (last === 1) {
    return `${days} день`;
  }

  if (last >= 2 && last <= 4) {
    return `${days} дня`;
  }

  return `${days} дней`;
}


function buildAvailabilityText(
  offer,
  locale
) {
  const text =
    PUBLIC_TEXT[locale] ||
    PUBLIC_TEXT.uk;

  const quantity =
    formatQuantity(
      offer.quantity
    );

  if (quantity <= 0) {
    return text.unavailable;
  }

  if (
    offer.sourceType ===
    "OWN_STOCK"
  ) {
    return text.ownAvailable;
  }

  const deliveryDays =
    Number(
      offer.deliveryDays
    ) || 0;

  if (deliveryDays <= 0) {
    return text.orderAvailable;
  }

  if (locale === "en") {
    return deliveryDays === 1
      ? "Delivery in 1 day"
      : `Delivery in ${deliveryDays} days`;
  }

  if (locale === "ru") {
    return (
      "Доставка " +
      formatRussianDays(
        deliveryDays
      )
    );
  }

  return (
    "Доставка " +
    formatUkrainianDays(
      deliveryDays
    )
  );
}


function mapPublicOffer(
  offer,
  locale
) {
  const quantity =
    formatQuantity(
      offer.quantity
    );

  const retailPrice =
    formatPrice(
      offer.retailPrice
    );

  if (
    !offer.isAvailable ||
    quantity <= 0 ||
    retailPrice === null
  ) {
    return null;
  }

  const text =
    PUBLIC_TEXT[locale] ||
    PUBLIC_TEXT.uk;

  return {
    id:
      offer.id,

    productId:
      offer.productId,

    sourceType:
      offer.sourceType,

    sourceLabel:
      offer.sourceType ===
      "OWN_STOCK"
        ? text.ownStock
        : text.partnerStock,

    quantity,

    displayQuantity:
      quantity > 5
        ? ">5"
        : String(quantity),

    retailPrice,

    ...(Array.isArray(offer.priceMatrix)
      ? {
          priceMatrix: offer.priceMatrix.map((row) => ({
            key: row.key,
            name: row.name,
            price: formatPrice(row.price),
            pricingMode: row.pricingMode || null,
            discountPercent:
              row.discountPercent === undefined
                ? null
                : Number(row.discountPercent),
          })),
        }
      : {}),

    deliveryDays:
      Number(
        offer.deliveryDays
      ) || 0,

    isAvailable:
      true,

    isReturnable:
      offer.isReturnable !== false,

    availabilityText:
      buildAvailabilityText(
        offer,
        locale
      ),
  };
}


function mapPublicOffers(
  offers,
  locale
) {
  return (offers || [])
    .map(
      (offer) =>
        mapPublicOffer(
          offer,
          locale
        )
    )
    .filter(Boolean);
}


function localizeRelated(
  relatedItems,
  names,
  locale
) {
  return (
    relatedItems || []
  ).map(
    (item) => ({
      product:
        localizeProduct(
          item.product,
          names
        ),

      offers:
        mapPublicOffers(
          item.offers,
          locale
        ),
    })
  );
}


export const PublicSearchPresenterService = {
  async present({
    requestedLocale,
    family,
    productCard,
    replacementSourceCard = null,
  }) {
    const locale =
      await resolvePublicLocale(
        requestedLocale
      );

    const names =
      await loadPublicNames(
        [
          ...collectProductIds(family, productCard),
          ...collectProductIds([], replacementSourceCard),
        ],
        locale
      );

    return {
      locale,

      family:
        localizeRelated(
          family,
          names,
          locale
        ),

      replacementSourceCard: replacementSourceCard
        ? {
            product: localizeProduct(replacementSourceCard.product, names),
            offers: mapPublicOffers(replacementSourceCard.offers, locale),
            analogs: localizeRelated(replacementSourceCard.analogs, names, locale),
            replacements: localizeRelated(replacementSourceCard.replacements, names, locale),
          }
        : null,

      productCard:
        productCard
          ? {
              product:
                localizeProduct(
                  productCard.product,
                  names
                ),

              offers:
                mapPublicOffers(
                  productCard.offers,
                  locale
                ),

              analogs:
                localizeRelated(
                  productCard.analogs,
                  names,
                  locale
                ),

              replacements:
                localizeRelated(
                  productCard.replacements,
                  names,
                  locale
                ),
            }
          : null,
    };
  },
};
