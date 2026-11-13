-- Separate customer inquiries for the Mercedes TXT fallback.
-- Never creates catalog offers, carts, reservations or orders.
-- Apply only to an isolated database until end-to-end review.

BEGIN;

CREATE TABLE IF NOT EXISTS special_order_inquiries (
  id BIGSERIAL PRIMARY KEY,

  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  article VARCHAR(120) NOT NULL
    CHECK (length(BTRIM(article)) > 0),

  contact_phone VARCHAR(16) NOT NULL
    CHECK (contact_phone ~ '^\+380[0-9]{9}$'),

  contact_name VARCHAR(120),

  quantity INTEGER NOT NULL DEFAULT 1
    CHECK (quantity BETWEEN 1 AND 20),

  locale VARCHAR(5) NOT NULL DEFAULT 'uk'
    CHECK (locale IN ('uk', 'ru', 'en')),

  source VARCHAR(16) NOT NULL
    CHECK (source IN ('WEBSITE', 'MAKATRON')),

  status VARCHAR(20) NOT NULL DEFAULT 'NEW'
    CHECK (status IN (
      'NEW', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'
    )),

  estimated_unit_price_uah NUMERIC(14,2) NOT NULL
    CHECK (estimated_unit_price_uah > 0),

  currency VARCHAR(3) NOT NULL DEFAULT 'UAH'
    CHECK (currency = 'UAH'),

  consent_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
  idx_special_order_inquiries_phone_created
ON special_order_inquiries (
  contact_phone,
  created_at DESC
);

CREATE INDEX IF NOT EXISTS
  idx_special_order_inquiries_status_created
ON special_order_inquiries (
  status,
  created_at DESC
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON special_order_inquiries TO autohub_app;

GRANT USAGE, SELECT
ON special_order_inquiries_id_seq TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('127_special_order_inquiries')
ON CONFLICT(version) DO NOTHING;

COMMIT;
