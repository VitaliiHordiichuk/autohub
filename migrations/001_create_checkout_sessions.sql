BEGIN;

-- История выполненных миграций
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Сессии оформления заказа
CREATE TABLE IF NOT EXISTS checkout_sessions (
    id SERIAL PRIMARY KEY,

    cart_id INTEGER NOT NULL
        REFERENCES carts(id) ON DELETE CASCADE,

    user_id INTEGER
        REFERENCES users(id) ON DELETE SET NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    expires_at TIMESTAMP NOT NULL,

    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT checkout_sessions_status_check
        CHECK (
            status IN (
                'ACTIVE',
                'COMPLETED',
                'EXPIRED',
                'CANCELLED'
            )
        )
);

-- Только одна активная checkout-сессия на корзину
CREATE UNIQUE INDEX IF NOT EXISTS
    uq_checkout_sessions_active_cart
ON checkout_sessions(cart_id)
WHERE status='ACTIVE';

CREATE INDEX IF NOT EXISTS
    idx_checkout_sessions_status_expires
ON checkout_sessions(status, expires_at);

CREATE INDEX IF NOT EXISTS
    idx_checkout_sessions_user
ON checkout_sessions(user_id);

-- Связь резервов с checkout
ALTER TABLE stock_reservations
ADD COLUMN IF NOT EXISTS checkout_session_id INTEGER
REFERENCES checkout_sessions(id)
ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS
    idx_stock_reservations_checkout_session
ON stock_reservations(checkout_session_id);

GRANT SELECT, INSERT, UPDATE, DELETE
ON checkout_sessions
TO autohub_app;

GRANT USAGE, SELECT
ON SEQUENCE checkout_sessions_id_seq
TO autohub_app;

GRANT SELECT
ON schema_migrations
TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES('001_create_checkout_sessions')
ON CONFLICT(version) DO NOTHING;

COMMIT;