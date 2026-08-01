CREATE TABLE IF NOT EXISTS order_returns (
  id BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','CANCELLED')),
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP WITHOUT TIME ZONE,
  cancelled_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE TABLE IF NOT EXISTS order_return_items (
  id BIGSERIAL PRIMARY KEY,
  return_id BIGINT NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  UNIQUE(return_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_return_items_order_item ON order_return_items(order_item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON order_returns, order_return_items TO autohub_app;
GRANT USAGE, SELECT ON SEQUENCE order_returns_id_seq, order_return_items_id_seq TO autohub_app;

INSERT INTO schema_migrations(version) VALUES ('049_create_order_returns') ON CONFLICT (version) DO NOTHING;
