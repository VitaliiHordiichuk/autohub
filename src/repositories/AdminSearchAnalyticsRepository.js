import {
  pool,
} from "../config/db.js";


function buildFilterValues({
  days,
  status,
  search,
}) {
  return [
    days,
    status,
    search || null,
  ];
}


const FILTER_SQL = `
  se.event_type = 'SEARCH'
  AND se.created_at >=
    CURRENT_TIMESTAMP -
    ($1::integer * INTERVAL '1 day')
  AND (
    $2::text = 'ALL'
    OR (
      $2::text = 'FOUND'
      AND se.found = TRUE
    )
    OR (
      $2::text = 'NOT_FOUND'
      AND se.found = FALSE
    )
  )
  AND (
    $3::text IS NULL
    OR se.raw_query ILIKE
      '%' || $3::text || '%'
    OR se.normalized_query ILIKE
      '%' || $3::text || '%'
    OR se.searched_article ILIKE
      '%' || $3::text || '%'
    OR se.city ILIKE
      '%' || $3::text || '%'
    OR u.email ILIKE
      '%' || $3::text || '%'
    OR u.first_name ILIKE
      '%' || $3::text || '%'
    OR u.last_name ILIKE
      '%' || $3::text || '%'
  )
`;


function numeric(value) {
  return Number(value || 0);
}


function nullableNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result = Number(value);

  return Number.isFinite(result)
    ? result
    : null;
}


function mapQueryRow(row) {
  return {
    query:
      row.query_value || "",

    sampleQuery:
      row.sample_query || "",

    searches:
      numeric(row.searches),

    foundSearches:
      numeric(row.found_searches),

    notFoundSearches:
      numeric(row.not_found_searches),

    uniqueVisitors:
      numeric(row.unique_visitors),

    lastSearchedAt:
      row.last_searched_at ?? null,
  };
}


function mapResult(row) {
  return {
    id:
      Number(row.id),

    productId:
      nullableNumber(
        row.product_id
      ),

    productOfferId:
      nullableNumber(
        row.product_offer_id
      ),

    relationType:
      row.relation_type,

    article:
      row.article,

    productName:
      row.product_name,

    retailPrice:
      nullableNumber(
        row.retail_price
      ),

    quantity:
      nullableNumber(
        row.quantity
      ),

    sourceType:
      row.source_type,

    sortPosition:
      numeric(row.sort_position),
  };
}


function mapRecentRow(row) {
  const results = Array.isArray(
    row.results
  )
    ? row.results.map(mapResult)
    : [];

  return {
    id:
      Number(row.id),

    rawQuery:
      row.raw_query,

    normalizedQuery:
      row.normalized_query,

    searchedArticle:
      row.searched_article,

    searchRule:
      row.search_rule,

    locale:
      row.locale,

    found:
      row.found === true,

    exactProductId:
      nullableNumber(
        row.exact_product_id
      ),

    resultProductsCount:
      numeric(
        row.result_products_count
      ),

    resultOffersCount:
      numeric(
        row.result_offers_count
      ),

    city:
      row.city,

    countryCode:
      row.country_code,

    visitorSessionId:
      row.visitor_session_id,

    userId:
      nullableNumber(row.user_id),

    user:
      row.user_id
        ? {
            id:
              Number(row.user_id),

            firstName:
              row.first_name,

            lastName:
              row.last_name,

            email:
              row.email,
          }
        : null,

    createdAt:
      row.created_at,

    results,
  };
}


export const AdminSearchAnalyticsRepository = {
  async getDashboard({
    days,
    status,
    search,
    page,
    limit,
  }) {
    const client =
      await pool.connect();

    const filterValues =
      buildFilterValues({
        days,
        status,
        search,
      });

    const offset =
      (page - 1) * limit;

    try {
      const summaryResult =
        await client.query(
          `
            SELECT
              COUNT(*) AS searches,

              COUNT(*) FILTER (
                WHERE se.found = TRUE
              ) AS found_searches,

              COUNT(*) FILTER (
                WHERE se.found = FALSE
              ) AS not_found_searches,

              COUNT(DISTINCT (
                CASE
                  WHEN se.user_id IS NOT NULL
                  THEN 'user:' ||
                    se.user_id::text

                  WHEN se.visitor_session_id
                    IS NOT NULL
                  THEN 'session:' ||
                    se.visitor_session_id

                  WHEN se.ip_hash IS NOT NULL
                  THEN 'ip:' || se.ip_hash

                  ELSE 'event:' ||
                    se.id::text
                END
              )) AS unique_visitors,

              COUNT(DISTINCT se.user_id)
                FILTER (
                  WHERE se.user_id
                    IS NOT NULL
                ) AS registered_users,

              COUNT(DISTINCT se.city)
                FILTER (
                  WHERE NULLIF(
                    BTRIM(se.city),
                    ''
                  ) IS NOT NULL
                ) AS cities,

              COALESCE(
                SUM(
                  se.result_products_count
                ),
                0
              ) AS shown_products,

              COALESCE(
                SUM(
                  se.result_offers_count
                ),
                0
              ) AS shown_offers

            FROM search_events se

            LEFT JOIN users u
              ON u.id = se.user_id

            WHERE ${FILTER_SQL};
          `,
          filterValues
        );

      const popularResult =
        await client.query(
          `
            SELECT
              COALESCE(
                NULLIF(
                  BTRIM(
                    se.normalized_query
                  ),
                  ''
                ),
                se.raw_query
              ) AS query_value,

              MIN(se.raw_query)
                AS sample_query,

              COUNT(*) AS searches,

              COUNT(*) FILTER (
                WHERE se.found = TRUE
              ) AS found_searches,

              COUNT(*) FILTER (
                WHERE se.found = FALSE
              ) AS not_found_searches,

              COUNT(DISTINCT (
                CASE
                  WHEN se.user_id IS NOT NULL
                  THEN 'user:' ||
                    se.user_id::text

                  WHEN se.visitor_session_id
                    IS NOT NULL
                  THEN 'session:' ||
                    se.visitor_session_id

                  WHEN se.ip_hash IS NOT NULL
                  THEN 'ip:' || se.ip_hash

                  ELSE 'event:' ||
                    se.id::text
                END
              )) AS unique_visitors,

              MAX(se.created_at)
                AS last_searched_at

            FROM search_events se

            LEFT JOIN users u
              ON u.id = se.user_id

            WHERE ${FILTER_SQL}

            GROUP BY
              COALESCE(
                NULLIF(
                  BTRIM(
                    se.normalized_query
                  ),
                  ''
                ),
                se.raw_query
              )

            ORDER BY
              searches DESC,
              last_searched_at DESC

            LIMIT 20;
          `,
          filterValues
        );

      const missingResult =
        await client.query(
          `
            SELECT
              COALESCE(
                NULLIF(
                  BTRIM(
                    se.normalized_query
                  ),
                  ''
                ),
                se.raw_query
              ) AS query_value,

              MIN(se.raw_query)
                AS sample_query,

              COUNT(*) AS searches,

              0 AS found_searches,

              COUNT(*) AS not_found_searches,

              COUNT(DISTINCT (
                CASE
                  WHEN se.user_id IS NOT NULL
                  THEN 'user:' ||
                    se.user_id::text

                  WHEN se.visitor_session_id
                    IS NOT NULL
                  THEN 'session:' ||
                    se.visitor_session_id

                  WHEN se.ip_hash IS NOT NULL
                  THEN 'ip:' || se.ip_hash

                  ELSE 'event:' ||
                    se.id::text
                END
              )) AS unique_visitors,

              MAX(se.created_at)
                AS last_searched_at

            FROM search_events se

            LEFT JOIN users u
              ON u.id = se.user_id

            WHERE ${FILTER_SQL}
              AND se.found = FALSE

            GROUP BY
              COALESCE(
                NULLIF(
                  BTRIM(
                    se.normalized_query
                  ),
                  ''
                ),
                se.raw_query
              )

            ORDER BY
              searches DESC,
              last_searched_at DESC

            LIMIT 20;
          `,
          filterValues
        );

      const citiesResult =
        await client.query(
          `
            SELECT
              se.city,
              se.country_code,
              COUNT(*) AS searches,
              COUNT(*) FILTER (
                WHERE se.found = FALSE
              ) AS not_found_searches,
              MAX(se.created_at)
                AS last_searched_at

            FROM search_events se

            LEFT JOIN users u
              ON u.id = se.user_id

            WHERE ${FILTER_SQL}
              AND NULLIF(
                BTRIM(se.city),
                ''
              ) IS NOT NULL

            GROUP BY
              se.city,
              se.country_code

            ORDER BY
              searches DESC,
              se.city ASC

            LIMIT 20;
          `,
          filterValues
        );

      const usersResult =
        await client.query(
          `
            SELECT
              u.id,
              u.first_name,
              u.last_name,
              u.email,
              COUNT(*) AS searches,
              COUNT(*) FILTER (
                WHERE se.found = FALSE
              ) AS not_found_searches,
              MAX(se.created_at)
                AS last_searched_at

            FROM search_events se

            INNER JOIN users u
              ON u.id = se.user_id

            WHERE ${FILTER_SQL}

            GROUP BY
              u.id,
              u.first_name,
              u.last_name,
              u.email

            ORDER BY
              searches DESC,
              last_searched_at DESC

            LIMIT 20;
          `,
          filterValues
        );

      const countResult =
        await client.query(
          `
            SELECT
              COUNT(*) AS total

            FROM search_events se

            LEFT JOIN users u
              ON u.id = se.user_id

            WHERE ${FILTER_SQL};
          `,
          filterValues
        );

      const recentResult =
        await client.query(
          `
            SELECT
              se.id,
              se.raw_query,
              se.normalized_query,
              se.searched_article,
              se.search_rule,
              se.locale,
              se.found,
              se.exact_product_id,
              se.result_products_count,
              se.result_offers_count,
              se.city,
              se.country_code,
              se.visitor_session_id,
              se.user_id,
              se.created_at,
              u.first_name,
              u.last_name,
              u.email,

              COALESCE(
                results.items,
                '[]'::json
              ) AS results

            FROM search_events se

            LEFT JOIN users u
              ON u.id = se.user_id

            LEFT JOIN LATERAL (
              SELECT
                JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'id', ser.id,
                    'product_id',
                      ser.product_id,
                    'product_offer_id',
                      ser.product_offer_id,
                    'relation_type',
                      ser.relation_type,
                    'article',
                      ser.article,
                    'product_name',
                      ser.product_name,
                    'retail_price',
                      ser.retail_price,
                    'quantity',
                      ser.quantity,
                    'source_type',
                      ser.source_type,
                    'sort_position',
                      ser.sort_position
                  )
                  ORDER BY
                    ser.sort_position,
                    ser.id
                ) AS items

              FROM search_event_results ser

              WHERE
                ser.search_event_id =
                  se.id
            ) results
              ON TRUE

            WHERE ${FILTER_SQL}

            ORDER BY
              se.created_at DESC,
              se.id DESC

            LIMIT $4
            OFFSET $5;
          `,
          [
            ...filterValues,
            limit,
            offset,
          ]
        );

      const summary =
        summaryResult.rows[0] || {};

      const total = numeric(
        countResult.rows[0]?.total
      );

      return {
        summary: {
          searches:
            numeric(summary.searches),

          foundSearches:
            numeric(
              summary.found_searches
            ),

          notFoundSearches:
            numeric(
              summary.not_found_searches
            ),

          uniqueVisitors:
            numeric(
              summary.unique_visitors
            ),

          registeredUsers:
            numeric(
              summary.registered_users
            ),

          cities:
            numeric(summary.cities),

          shownProducts:
            numeric(
              summary.shown_products
            ),

          shownOffers:
            numeric(
              summary.shown_offers
            ),
        },

        popularQueries:
          popularResult.rows.map(
            mapQueryRow
          ),

        missingQueries:
          missingResult.rows.map(
            mapQueryRow
          ),

        cities:
          citiesResult.rows.map(
            (row) => ({
              city:
                row.city,

              countryCode:
                row.country_code,

              searches:
                numeric(row.searches),

              notFoundSearches:
                numeric(
                  row.not_found_searches
                ),

              lastSearchedAt:
                row.last_searched_at,
            })
          ),

        users:
          usersResult.rows.map(
            (row) => ({
              id:
                Number(row.id),

              firstName:
                row.first_name,

              lastName:
                row.last_name,

              email:
                row.email,

              searches:
                numeric(row.searches),

              notFoundSearches:
                numeric(
                  row.not_found_searches
                ),

              lastSearchedAt:
                row.last_searched_at,
            })
          ),

        recent: {
          page,
          limit,
          total,
          pages:
            Math.max(
              1,
              Math.ceil(
                total / limit
              )
            ),
          rows:
            recentResult.rows.map(
              mapRecentRow
            ),
        },
      };
    } finally {
      client.release();
    }
  },
};
