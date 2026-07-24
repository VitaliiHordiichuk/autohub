BEGIN;


CREATE TABLE IF NOT EXISTS warehouse_import_settings (

    id SERIAL PRIMARY KEY,

    warehouse_id INTEGER NOT NULL,

    brand_mode VARCHAR(30) NOT NULL DEFAULT 'NONE',

    fixed_brand_id INTEGER,

    brand_column INTEGER,

    article_column INTEGER NOT NULL DEFAULT 1,

    name_column INTEGER NOT NULL DEFAULT 2,

    price_column INTEGER NOT NULL DEFAULT 3,

    quantity_column INTEGER NOT NULL DEFAULT 4,


    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,


    CONSTRAINT warehouse_import_settings_warehouse_fk
        FOREIGN KEY (warehouse_id)
        REFERENCES warehouses(id)
        ON DELETE CASCADE,


    CONSTRAINT warehouse_import_settings_brand_fk
        FOREIGN KEY (fixed_brand_id)
        REFERENCES brands(id)
        ON DELETE SET NULL,


    CONSTRAINT warehouse_import_settings_unique
        UNIQUE (warehouse_id)

);


CREATE INDEX IF NOT EXISTS
idx_warehouse_import_settings_warehouse
ON warehouse_import_settings(warehouse_id);


COMMIT;