BEGIN;
SET LOCAL lock_timeout = '5s';

-- Separate first-party page views. No query strings, IPs, names or contacts.
CREATE TABLE IF NOT EXISTS site_page_views (
  id UUID PRIMARY KEY,
  visitor_key CHAR(64) NOT NULL,
  visit_key CHAR(64) NOT NULL,
  route VARCHAR(24) NOT NULL,
  locale VARCHAR(2) NOT NULL CHECK (locale IN ('uk', 'ru', 'en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT site_page_views_route_check CHECK (route IN (
    'home', 'catalog', 'product', 'brand', 'search', 'vin-request', 'help',
    'contacts', 'returns', 'privacy', 'cart', 'checkout', 'order-success',
    'login', 'register', 'forgot-password', 'reset-password', 'change-password',
    'account', 'notifications'
  ))
);
CREATE INDEX IF NOT EXISTS idx_site_page_views_created ON site_page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_site_page_views_visitor_created ON site_page_views(visitor_key, created_at);
CREATE INDEX IF NOT EXISTS idx_site_page_views_visit_created ON site_page_views(visit_key, created_at);
GRANT SELECT, INSERT, DELETE ON site_page_views TO autohub_app;

INSERT INTO schema_migrations(version, executed_at)
VALUES ('133_create_site_traffic', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
ON CONFLICT(version) DO NOTHING;
COMMIT;
