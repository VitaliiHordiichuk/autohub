import {
  pool,
} from "../config/db.js";


function buildFilterValues({
  days,
  status,
  search,
  date,
}) {
  return [
    days,
    status,
    search || null,
    date || null,
  ];
}


const FILTER_SQL = `
  se.event_type = 'SEARCH'
  AND (
    (
      $4::date IS NULL
      AND se.created_at >=
        CURRENT_TIMESTAMP -
        ($1::integer * INTERVAL '1 day')
    )
    OR (
      $4::date IS NOT NULL
      AND (
        se.created_at
          AT TIME ZONE 'UTC'
          AT TIME ZONE 'Europe/Kyiv'
      )::date = $4::date
    )
  )
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


function percentage(value, total) {
  if (!total) {
    return null;
  }

  return Number(
    (
      (value / total) * 100
    ).toFixed(1)
  );
}


function mapFunnelStage({
  key,
  events,
  visitors,
  previousVisitors,
  searchVisitors,
}) {
  return {
    key,
    events,
    visitors,
    conversionFromPrevious:
      previousVisitors === null
        ? null
        : percentage(
            visitors,
            previousVisitors
          ),
    conversionFromSearch:
      key === "SEARCH"
        ? searchVisitors > 0
          ? 100
          : null
        : percentage(
            visitors,
            searchVisitors
          ),
  };
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

    supplierName:
      row.supplier_name,

    warehouseName:
      row.warehouse_name,

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
    date,
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
        date,
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
                    'supplier_name',
                      ser.supplier_name,
                    'warehouse_name',
                      ser.warehouse_name,
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

            LIMIT $5
            OFFSET $6;
          `,
          [
            ...filterValues,
            limit,
            offset,
          ]
        );

      const funnelResult =
        await client.query(
          `
            WITH scoped_events AS (
              SELECT
                'SEARCH'::text AS event_type,
                se.visitor_session_id,
                se.user_id,
                se.created_at
              FROM search_events se
              WHERE se.event_type = 'SEARCH'
                AND (
                  (
                    $2::date IS NULL
                    AND se.created_at >=
                      CURRENT_TIMESTAMP -
                      ($1::integer * INTERVAL '1 day')
                  )
                  OR (
                    $2::date IS NOT NULL
                    AND (
                      se.created_at
                        AT TIME ZONE 'UTC'
                        AT TIME ZONE 'Europe/Kyiv'
                    )::date = $2::date
                  )
                )

              UNION ALL

              SELECT
                fe.event_type::text,
                fe.visitor_session_id,
                fe.user_id,
                fe.created_at
              FROM funnel_events fe
              WHERE (
                (
                  $2::date IS NULL
                  AND fe.created_at >=
                    CURRENT_TIMESTAMP -
                    ($1::integer * INTERVAL '1 day')
                )
                OR (
                  $2::date IS NOT NULL
                  AND (
                    fe.created_at
                      AT TIME ZONE 'UTC'
                      AT TIME ZONE 'Europe/Kyiv'
                  )::date = $2::date
                )
              )
            ),
            identified AS (
              SELECT
                event_type,
                created_at,
                CASE
                  WHEN visitor_session_id IS NOT NULL
                    THEN 'session:' || visitor_session_id
                  WHEN user_id IS NOT NULL
                    THEN 'user:' || user_id::text
                  ELSE NULL
                END AS visitor_key
              FROM scoped_events
            ),
            trackable AS (
              SELECT *
              FROM identified
              WHERE visitor_key IS NOT NULL
            ),
            first_search AS (
              SELECT
                visitor_key,
                MIN(created_at) AS search_at
              FROM trackable
              WHERE event_type = 'SEARCH'
              GROUP BY visitor_key
            ),
            product_reached AS (
              SELECT
                search.visitor_key,
                search.search_at,
                (
                  SELECT MIN(event.created_at)
                  FROM trackable event
                  WHERE event.visitor_key =
                    search.visitor_key
                    AND event.event_type =
                      'PRODUCT_VIEW'
                    AND event.created_at >=
                      search.search_at
                ) AS product_at
              FROM first_search search
            ),
            cart_reached AS (
              SELECT
                product.*,
                (
                  SELECT MIN(event.created_at)
                  FROM trackable event
                  WHERE event.visitor_key =
                    product.visitor_key
                    AND event.event_type =
                      'ADD_TO_CART'
                    AND event.created_at >=
                      product.product_at
                ) AS cart_at
              FROM product_reached product
            ),
            checkout_reached AS (
              SELECT
                cart.*,
                (
                  SELECT MIN(event.created_at)
                  FROM trackable event
                  WHERE event.visitor_key =
                    cart.visitor_key
                    AND event.event_type =
                      'CHECKOUT_STARTED'
                    AND event.created_at >=
                      cart.cart_at
                ) AS checkout_at
              FROM cart_reached cart
            ),
            order_reached AS (
              SELECT
                checkout.*,
                (
                  SELECT MIN(event.created_at)
                  FROM trackable event
                  WHERE event.visitor_key =
                    checkout.visitor_key
                    AND event.event_type =
                      'ORDER_CREATED'
                    AND event.created_at >=
                      checkout.checkout_at
                ) AS order_at
              FROM checkout_reached checkout
            ),
            vin_reached AS (
              SELECT
                product.visitor_key,
                (
                  SELECT MIN(event.created_at)
                  FROM trackable event
                  WHERE event.visitor_key =
                    product.visitor_key
                    AND event.event_type =
                      'VIN_REQUEST_CREATED'
                    AND event.created_at >=
                      product.product_at
                ) AS vin_request_at
              FROM product_reached product
            )
            SELECT
              (
                SELECT COUNT(*)
                FROM scoped_events
                WHERE event_type = 'SEARCH'
              ) AS search_events,
              (
                SELECT COUNT(*)
                FROM scoped_events
                WHERE event_type = 'PRODUCT_VIEW'
              ) AS product_events,
              (
                SELECT COUNT(*)
                FROM scoped_events
                WHERE event_type = 'ADD_TO_CART'
              ) AS cart_events,
              (
                SELECT COUNT(*)
                FROM scoped_events
                WHERE event_type = 'CHECKOUT_STARTED'
              ) AS checkout_events,
              (
                SELECT COUNT(*)
                FROM scoped_events
                WHERE event_type = 'ORDER_CREATED'
              ) AS order_events,
              (
                SELECT COUNT(*)
                FROM scoped_events
                WHERE event_type = 'VIN_REQUEST_CREATED'
              ) AS vin_request_events,
              (
                SELECT COUNT(*)
                FROM first_search
              ) AS search_visitors,
              (
                SELECT COUNT(*)
                FROM product_reached
                WHERE product_at IS NOT NULL
              ) AS product_visitors,
              (
                SELECT COUNT(*)
                FROM cart_reached
                WHERE cart_at IS NOT NULL
              ) AS cart_visitors,
              (
                SELECT COUNT(*)
                FROM checkout_reached
                WHERE checkout_at IS NOT NULL
              ) AS checkout_visitors,
              (
                SELECT COUNT(*)
                FROM order_reached
                WHERE order_at IS NOT NULL
              ) AS order_visitors,
              (
                SELECT COUNT(*)
                FROM vin_reached
                WHERE vin_request_at IS NOT NULL
              ) AS vin_request_visitors;
          `,
          [
            days,
            date || null,
          ]
        );

      const summary =
        summaryResult.rows[0] || {};

      const funnel =
        funnelResult.rows[0] || {};

      const searchVisitors =
        numeric(
          funnel.search_visitors
        );

      const productVisitors =
        numeric(
          funnel.product_visitors
        );

      const cartVisitors =
        numeric(
          funnel.cart_visitors
        );

      const checkoutVisitors =
        numeric(
          funnel.checkout_visitors
        );

      const orderVisitors =
        numeric(
          funnel.order_visitors
        );

      const vinRequestVisitors =
        numeric(
          funnel.vin_request_visitors
        );

      const total = numeric(
        countResult.rows[0]?.total
      );

      return {
        funnel: {
          stages: [
            mapFunnelStage({
              key: "SEARCH",
              events:
                numeric(
                  funnel.search_events
                ),
              visitors:
                searchVisitors,
              previousVisitors: null,
              searchVisitors,
            }),
            mapFunnelStage({
              key: "PRODUCT_VIEW",
              events:
                numeric(
                  funnel.product_events
                ),
              visitors:
                productVisitors,
              previousVisitors:
                searchVisitors,
              searchVisitors,
            }),
            mapFunnelStage({
              key: "ADD_TO_CART",
              events:
                numeric(
                  funnel.cart_events
                ),
              visitors:
                cartVisitors,
              previousVisitors:
                productVisitors,
              searchVisitors,
            }),
            mapFunnelStage({
              key: "CHECKOUT_STARTED",
              events:
                numeric(
                  funnel.checkout_events
                ),
              visitors:
                checkoutVisitors,
              previousVisitors:
                cartVisitors,
              searchVisitors,
            }),
            mapFunnelStage({
              key: "ORDER_CREATED",
              events:
                numeric(
                  funnel.order_events
                ),
              visitors:
                orderVisitors,
              previousVisitors:
                checkoutVisitors,
              searchVisitors,
            }),
          ],
          vinRequest:
            mapFunnelStage({
              key: "VIN_REQUEST_CREATED",
              events:
                numeric(
                  funnel.vin_request_events
                ),
              visitors:
                vinRequestVisitors,
              previousVisitors:
                productVisitors,
              searchVisitors,
            }),
        },

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
