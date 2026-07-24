BEGIN;


CREATE TABLE warehouse_supplier_imports
(
    id SERIAL PRIMARY KEY,


    warehouse_id INTEGER NOT NULL,

    supplier_id INTEGER NOT NULL,

    supplier_import_settings_id INTEGER NOT NULL,


    is_active BOOLEAN NOT NULL DEFAULT TRUE,


    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,


    CONSTRAINT warehouse_supplier_imports_warehouse_fk
        FOREIGN KEY (warehouse_id)
        REFERENCES warehouses(id)
        ON DELETE CASCADE,


    CONSTRAINT warehouse_supplier_imports_supplier_fk
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE CASCADE,


    CONSTRAINT warehouse_supplier_imports_settings_fk
        FOREIGN KEY (supplier_import_settings_id)
        REFERENCES supplier_import_settings(id)
        ON DELETE CASCADE

);



CREATE INDEX idx_warehouse_supplier_imports_warehouse
ON warehouse_supplier_imports(warehouse_id);



CREATE INDEX idx_warehouse_supplier_imports_supplier
ON warehouse_supplier_imports(supplier_id);



COMMIT;