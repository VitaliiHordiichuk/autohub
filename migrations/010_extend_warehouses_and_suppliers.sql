BEGIN;

-- Дополнительные данные поставщика
ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS email VARCHAR(150),
    ADD COLUMN IF NOT EXISTS comment TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP;

-- Расширяем карточку склада
ALTER TABLE warehouses
    ADD COLUMN IF NOT EXISTS supplier_id INTEGER,
    ADD COLUMN IF NOT EXISTS delivery_days INTEGER
        NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pickup_available BOOLEAN
        NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS shipping_available BOOLEAN
        NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN
        NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS last_import_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP;

-- Склад поставщика связан с конкретным поставщиком
ALTER TABLE warehouses
    DROP CONSTRAINT IF EXISTS warehouses_supplier_id_fkey;

ALTER TABLE warehouses
    ADD CONSTRAINT warehouses_supplier_id_fkey
    FOREIGN KEY (supplier_id)
    REFERENCES suppliers(id)
    ON DELETE RESTRICT;

-- Допустимые типы складов
ALTER TABLE warehouses
    DROP CONSTRAINT IF EXISTS warehouses_type_check;

ALTER TABLE warehouses
    ADD CONSTRAINT warehouses_type_check
    CHECK (
        type IN (
            'OWN',
            'SUPPLIER'
        )
    );

-- Проверяем правильность связи типа склада с поставщиком
ALTER TABLE warehouses
    DROP CONSTRAINT IF EXISTS warehouses_supplier_type_check;

ALTER TABLE warehouses
    ADD CONSTRAINT warehouses_supplier_type_check
    CHECK (
        (
            type = 'OWN'
            AND supplier_id IS NULL
        )
        OR
        (
            type = 'SUPPLIER'
            AND supplier_id IS NOT NULL
        )
    );

CREATE INDEX IF NOT EXISTS
    idx_warehouses_supplier
ON warehouses(supplier_id);

CREATE INDEX IF NOT EXISTS
    idx_warehouses_type_active
ON warehouses(type, is_active);

CREATE INDEX IF NOT EXISTS
    idx_suppliers_active
ON suppliers(is_active);

INSERT INTO schema_migrations(version)
VALUES ('010_extend_warehouses_and_suppliers')
ON CONFLICT(version) DO NOTHING;

COMMIT;