-- MAKA TXT inquiry notifications: durable transactional event + per-recipient delivery.
-- STEP 127: candidate ONLY. Do NOT apply to production as part of this script.
-- Requires migration 127_special_order_inquiries.
BEGIN;

CREATE TABLE special_order_inquiry_notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    inquiry_id BIGINT NOT NULL UNIQUE
        REFERENCES special_order_inquiries(id) ON DELETE CASCADE,
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'EXPANDED')),
    preparation_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (preparation_attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_special_order_inquiry_outbox_pending
    ON special_order_inquiry_notification_outbox (next_attempt_at, id)
    WHERE status = 'PENDING';

CREATE TABLE special_order_inquiry_notification_deliveries (
    id BIGSERIAL PRIMARY KEY,
    outbox_id BIGINT NOT NULL
        REFERENCES special_order_inquiry_notification_outbox(id) ON DELETE CASCADE,
    telegram_chat_id TEXT NOT NULL
        CHECK (length(telegram_chat_id) BETWEEN 1 AND 32),
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'IN_FLIGHT', 'SENT', 'SKIPPED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0
        CHECK (attempts BETWEEN 0 AND 8),
    claim_token UUID,
    lease_until TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error_code VARCHAR(32),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (outbox_id, telegram_chat_id),
    CHECK (status = 'IN_FLIGHT' OR (claim_token IS NULL AND lease_until IS NULL))
);

CREATE INDEX idx_special_order_inquiry_delivery_pending
    ON special_order_inquiry_notification_deliveries (next_attempt_at, id)
    WHERE status = 'PENDING';
CREATE INDEX idx_special_order_inquiry_delivery_leases
    ON special_order_inquiry_notification_deliveries (lease_until, id)
    WHERE status = 'IN_FLIGHT';

GRANT SELECT, INSERT, UPDATE, DELETE
    ON special_order_inquiry_notification_outbox,
       special_order_inquiry_notification_deliveries TO autohub_app;
GRANT USAGE, SELECT
    ON special_order_inquiry_notification_outbox_id_seq,
       special_order_inquiry_notification_deliveries_id_seq TO autohub_app;

INSERT INTO schema_migrations(version)
VALUES ('129_special_order_inquiry_notification_outbox')
ON CONFLICT(version) DO NOTHING;
COMMIT;
