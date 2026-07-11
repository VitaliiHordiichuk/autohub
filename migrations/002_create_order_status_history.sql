BEGIN;

-- История изменения статусов заказа
CREATE TABLE IF NOT EXISTS order_status_history (
    id SERIAL PRIMARY KEY,

    order_id INTEGER NOT NULL
        REFERENCES orders(id)
        ON DELETE CASCADE,

    old_status VARCHAR(50),

    new_status VARCHAR(50) NOT NULL,

    changed_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,

    comment TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Индекс для быстрого получения истории заказа
CREATE INDEX IF NOT EXISTS
    idx_order_status_history_order
ON order_status_history(order_id, created_at);

-- Права приложению
GRANT SELECT, INSERT, UPDATE, DELETE
ON order_status_history
TO autohub_app;

GRANT USAGE, SELECT
ON SEQUENCE order_status_history_id_seq
TO autohub_app;

-- Запись о выполненной миграции
INSERT INTO schema_migrations(version)
VALUES('002_create_order_status_history')
ON CONFLICT(version) DO NOTHING;

COMMIT;