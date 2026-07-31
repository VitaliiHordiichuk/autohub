CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key VARCHAR(160) NOT NULL,
  type VARCHAR(50) NOT NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_notifications_user_event_unique UNIQUE (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
  ON user_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

INSERT INTO schema_migrations(version)
VALUES ('043_create_notifications')
ON CONFLICT (version) DO NOTHING;
