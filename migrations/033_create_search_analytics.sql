BEGIN;

CREATE TABLE IF NOT EXISTS search_events (
  id BIGSERIAL PRIMARY KEY,

  event_type VARCHAR(30)
    NOT NULL DEFAULT 'SEARCH',

  visitor_session_id VARCHAR(100),

  user_id INTEGER
    REFERENCES users(id)
    ON DELETE SET NULL,

  raw_query VARCHAR(255) NOT NULL,
  normalized_query VARCHAR(255),
  searched_article VARCHAR(255),
  search_rule VARCHAR(50),
  locale VARCHAR(10),

  found BOOLEAN NOT NULL,

  exact_product_id INTEGER
    REFERENCES products(id)
    ON DELETE SET NULL,

  result_products_count INTEGER
    NOT NULL DEFAULT 0,

  result_offers_count INTEGER
    NOT NULL DEFAULT 0,

  city VARCHAR(150),
  country_code VARCHAR(10),
  ip_hash VARCHAR(64),
  user_agent TEXT,

  created_at TIMESTAMP
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT search_events_type_check
    CHECK (
      event_type IN (
        'SEARCH',
        'PRODUCT_VIEW'
      )
    ),

  CONSTRAINT search_events_products_count_check
    CHECK (result_products_count >= 0),

  CONSTRAINT search_events_offers_count_check
    CHECK (result_offers_count >= 0)
);

CREATE TABLE IF NOT EXISTS search_event_results (
  id BIGSERIAL PRIMARY KEY,

  search_event_id BIGINT NOT NULL
    REFERENCES search_events(id)
    ON DELETE CASCADE,

  product_id INTEGER
    REFERENCES products(id)
    ON DELETE SET NULL,

  product_offer_id INTEGER
    REFERENCES product_offers(id)
    ON DELETE SET NULL,

  relation_type VARCHAR(30) NOT NULL,

  article VARCHAR(100),
  product_name VARCHAR(255),

  retail_price NUMERIC(12,2),
  quantity NUMERIC(10,2),
  source_type VARCHAR(50),

  sort_position INTEGER
    NOT NULL DEFAULT 0,

  created_at TIMESTAMP
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT search_event_results_relation_check
    CHECK (
      relation_type IN (
        'EXACT',
        'FAMILY',
        'ANALOG',
        'REPLACEMENT'
      )
    ),

  CONSTRAINT search_event_results_position_check
    CHECK (sort_position >= 0)
);

CREATE INDEX IF NOT EXISTS
  idx_search_events_created
ON search_events(created_at DESC);

CREATE INDEX IF NOT EXISTS
  idx_search_events_query
ON search_events(normalized_query, created_at DESC);

CREATE INDEX IF NOT EXISTS
  idx_search_events_found
ON search_events(found, created_at DESC);

CREATE INDEX IF NOT EXISTS
  idx_search_events_user
ON search_events(user_id, created_at DESC)
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  idx_search_events_session
ON search_events(visitor_session_id, created_at DESC)
WHERE visitor_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  idx_search_events_city
ON search_events(city, created_at DESC)
WHERE city IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  idx_search_event_results_event
ON search_event_results(search_event_id, sort_position);

CREATE INDEX IF NOT EXISTS
  idx_search_event_results_product
ON search_event_results(product_id, created_at DESC)
WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  idx_search_event_results_offer
ON search_event_results(product_offer_id, created_at DESC)
WHERE product_offer_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
ON search_events, search_event_results
TO autohub_app;

GRANT USAGE, SELECT
ON SEQUENCE
  search_events_id_seq,
  search_event_results_id_seq
TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('033_create_search_analytics')
ON CONFLICT(version)
DO NOTHING;

COMMIT;
