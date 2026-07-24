BEGIN;

ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS email VARCHAR(150),
    ADD COLUMN IF NOT EXISTS contact_person VARCHAR(150),
    ADD COLUMN IF NOT EXISTS edrpou VARCHAR(20),
    ADD COLUMN IF NOT EXISTS bank_account VARCHAR(50),
    ADD COLUMN IF NOT EXISTS website VARCHAR(255),
    ADD COLUMN IF NOT EXISTS city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS comment TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP;


CREATE INDEX IF NOT EXISTS
    idx_suppliers_active
ON suppliers(is_active);


CREATE INDEX IF NOT EXISTS
    idx_suppliers_name
ON suppliers(name);


INSERT INTO schema_migrations(version)
VALUES ('011_extend_suppliers')
ON CONFLICT(version) DO NOTHING;


COMMIT;