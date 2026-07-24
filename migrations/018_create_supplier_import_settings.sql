BEGIN;


CREATE TABLE supplier_import_settings
(
    id SERIAL PRIMARY KEY,


    supplier_id INTEGER NOT NULL,


    import_method VARCHAR(30) NOT NULL DEFAULT 'MANUAL',

    file_type VARCHAR(20) NOT NULL DEFAULT 'CSV',


    brand_mode VARCHAR(30) NOT NULL DEFAULT 'NONE',

    fixed_brand_id INTEGER,


    brand_column INTEGER,

    article_column INTEGER NOT NULL DEFAULT 1,

    name_column INTEGER NOT NULL DEFAULT 2,

    price_column INTEGER NOT NULL DEFAULT 3,

    quantity_column INTEGER NOT NULL DEFAULT 4,


    start_row INTEGER NOT NULL DEFAULT 2,


    email_from VARCHAR(150),

    email_subject VARCHAR(255),


    is_active BOOLEAN NOT NULL DEFAULT TRUE,


    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,


    CONSTRAINT supplier_import_settings_supplier_fk
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE CASCADE,


    CONSTRAINT supplier_import_settings_brand_fk
        FOREIGN KEY (fixed_brand_id)
        REFERENCES brands(id)
        ON DELETE SET NULL

);



CREATE INDEX idx_supplier_import_settings_supplier
ON supplier_import_settings(supplier_id);



COMMIT;