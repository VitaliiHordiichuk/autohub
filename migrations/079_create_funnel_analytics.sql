BEGIN;

CREATE TABLE IF NOT EXISTS funnel_events (
  id BIGSERIAL PRIMARY KEY,

  event_type VARCHAR(30) NOT NULL,
  visitor_session_id VARCHAR(100),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_offer_id INTEGER REFERENCES product_offers(id) ON DELETE SET NULL,
  cart_id INTEGER REFERENCES carts(id) ON DELETE SET NULL,
  checkout_id INTEGER REFERENCES checkout_sessions(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  vin_request_id BIGINT REFERENCES vin_requests(id) ON DELETE SET NULL,

  source VARCHAR(40),
  locale VARCHAR(10),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT funnel_events_type_check
    CHECK (
      event_type IN (
        'PRODUCT_VIEW',
        'ADD_TO_CART',
        'CHECKOUT_STARTED',
        'ORDER_CREATED',
        'VIN_REQUEST_CREATED'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_created
  ON funnel_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_funnel_events_type_created
  ON funnel_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_funnel_events_session_created
  ON funnel_events(visitor_session_id, created_at DESC)
  WHERE visitor_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_funnel_events_user_created
  ON funnel_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_funnel_events_checkout_started
  ON funnel_events(checkout_id)
  WHERE event_type = 'CHECKOUT_STARTED' AND checkout_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_funnel_events_order_created
  ON funnel_events(order_id)
  WHERE event_type = 'ORDER_CREATED' AND order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_funnel_events_vin_request_created
  ON funnel_events(vin_request_id)
  WHERE event_type = 'VIN_REQUEST_CREATED' AND vin_request_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON funnel_events
  TO autohub_app;

GRANT USAGE, SELECT
  ON SEQUENCE funnel_events_id_seq
  TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('079_create_funnel_analytics')
ON CONFLICT(version)
DO NOTHING;

COMMIT;
