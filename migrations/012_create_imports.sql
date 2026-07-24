BEGIN;

CREATE TABLE IF NOT EXISTS imports (
    id SERIAL PRIMARY KEY,

    warehouse_id INTEGER NOT NULL,

    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),

    status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',

    rows_total INTEGER DEFAULT 0,
    rows_created INTEGER DEFAULT 0,
    rows_updated INTEGER DEFAULT 0,
    rows_deleted INTEGER DEFAULT 0,

    error_message TEXT,

    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP,

    created_by INTEGER,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT imports_warehouse_fk
        FOREIGN KEY (warehouse_id)
        REFERENCES warehouses(id)
        ON DELETE CASCADE
);


CREATE INDEX IF NOT EXISTS
idx_imports_warehouse_created
ON imports(
    warehouse_id,
    created_at DESC
);


CREATE INDEX IF NOT EXISTS
idx_imports_status
ON imports(status);


INSERT INTO schema_migrations(version)
VALUES ('012_create_imports')
ON CONFLICT(version) DO NOTHING;


COMMIT;