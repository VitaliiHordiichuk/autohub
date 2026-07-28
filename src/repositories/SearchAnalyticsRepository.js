import {
  pool,
} from "../config/db.js";


export const SearchAnalyticsRepository = {
  async createSearchEvent(
    event
  ) {
    const client =
      await pool.connect();

    try {
      await client.query(
        "BEGIN"
      );

      const eventResult =
        await client.query(
          `
            INSERT INTO search_events (
              event_type,
              visitor_session_id,
              user_id,
              raw_query,
              normalized_query,
              searched_article,
              search_rule,
              locale,
              found,
              exact_product_id,
              result_products_count,
              result_offers_count,
              city,
              country_code,
              ip_hash,
              user_agent
            )
            VALUES (
              'SEARCH',
              $1, $2, $3, $4,
              $5, $6, $7, $8,
              $9, $10, $11, $12,
              $13, $14, $15
            )
            RETURNING id;
          `,
          [
            event.visitorSessionId,
            event.userId,
            event.rawQuery,
            event.normalizedQuery,
            event.searchedArticle,
            event.searchRule,
            event.locale,
            event.found,
            event.exactProductId,
            event.resultProductsCount,
            event.resultOffersCount,
            event.city,
            event.countryCode,
            event.ipHash,
            event.userAgent,
          ]
        );

      const searchEventId =
        Number(
          eventResult.rows[0].id
        );

      for (
        const result of
          event.results
      ) {
        await client.query(
          `
            INSERT INTO search_event_results (
              search_event_id,
              product_id,
              product_offer_id,
              relation_type,
              article,
              product_name,
              retail_price,
              quantity,
              source_type,
              sort_position
            )
            VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9, $10
            );
          `,
          [
            searchEventId,
            result.productId,
            result.productOfferId,
            result.relationType,
            result.article,
            result.productName,
            result.retailPrice,
            result.quantity,
            result.sourceType,
            result.sortPosition,
          ]
        );
      }

      await client.query(
        "COMMIT"
      );

      return searchEventId;
    } catch (error) {
      await client.query(
        "ROLLBACK"
      );

      throw error;
    } finally {
      client.release();
    }
  },
};
