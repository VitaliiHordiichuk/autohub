BEGIN;


ALTER TABLE imports

ADD COLUMN IF NOT EXISTS supplier_id INTEGER,

ADD COLUMN IF NOT EXISTS warehouse_supplier_import_id INTEGER,

ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),

ADD COLUMN IF NOT EXISTS file_type VARCHAR(20),

ADD COLUMN IF NOT EXISTS import_method VARCHAR(30);



ALTER TABLE imports

ADD CONSTRAINT imports_supplier_fk

FOREIGN KEY (supplier_id)

REFERENCES suppliers(id)

ON DELETE SET NULL;



ALTER TABLE imports

ADD CONSTRAINT imports_warehouse_supplier_import_fk

FOREIGN KEY (warehouse_supplier_import_id)

REFERENCES warehouse_supplier_imports(id)

ON DELETE SET NULL;



COMMIT;