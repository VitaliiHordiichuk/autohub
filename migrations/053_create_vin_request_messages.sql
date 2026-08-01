CREATE TABLE IF NOT EXISTS vin_request_messages (
  id BIGSERIAL PRIMARY KEY,
  vin_request_id BIGINT NOT NULL REFERENCES vin_requests(id) ON DELETE CASCADE,
  sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_role VARCHAR(40),
  message TEXT NOT NULL CHECK (BTRIM(message) <> ''),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vin_request_messages_request
  ON vin_request_messages(vin_request_id, created_at, id);

INSERT INTO vin_request_messages(vin_request_id, sender_user_id, sender_role, message, created_at)
SELECT vr.id, vr.answered_by, r.name, vr.manager_response, COALESCE(vr.answered_at, vr.updated_at)
FROM vin_requests vr
LEFT JOIN users u ON u.id = vr.answered_by
LEFT JOIN roles r ON r.id = u.role_id
WHERE vr.manager_response IS NOT NULL AND BTRIM(vr.manager_response) <> '';

GRANT SELECT, INSERT, UPDATE, DELETE ON vin_request_messages TO autohub_app;
GRANT USAGE, SELECT ON SEQUENCE vin_request_messages_id_seq TO autohub_app;
UPDATE vin_requests SET contact_phone = '+38' || contact_phone
WHERE contact_phone ~ '^0[0-9]{9}$';
INSERT INTO schema_migrations(version) VALUES ('053_create_vin_request_messages') ON CONFLICT (version) DO NOTHING;
