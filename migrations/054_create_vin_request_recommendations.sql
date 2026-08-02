CREATE TABLE IF NOT EXISTS vin_request_recommendations (
  id BIGSERIAL PRIMARY KEY,
  vin_request_id BIGINT NOT NULL REFERENCES vin_requests(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_offer_id BIGINT NOT NULL REFERENCES product_offers(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vin_request_id, product_offer_id)
);

CREATE INDEX IF NOT EXISTS idx_vin_request_recommendations_request
  ON vin_request_recommendations(vin_request_id, created_at, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON vin_request_recommendations TO autohub_app;
GRANT USAGE, SELECT ON SEQUENCE vin_request_recommendations_id_seq TO autohub_app;
INSERT INTO schema_migrations(version) VALUES ('054_create_vin_request_recommendations') ON CONFLICT (version) DO NOTHING;
