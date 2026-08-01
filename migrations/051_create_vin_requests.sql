CREATE TABLE IF NOT EXISTS vin_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin VARCHAR(17) NOT NULL,
  request_text TEXT NOT NULL,
  contact_phone VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','IN_PROGRESS','ANSWERED','CLOSED')),
  manager_response TEXT,
  answered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  answered_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vin_requests_user ON vin_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vin_requests_status ON vin_requests(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON vin_requests TO autohub_app;
GRANT USAGE, SELECT ON SEQUENCE vin_requests_id_seq TO autohub_app;
INSERT INTO schema_migrations(version) VALUES ('051_create_vin_requests') ON CONFLICT (version) DO NOTHING;
