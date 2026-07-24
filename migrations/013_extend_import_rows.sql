BEGIN;

ALTER TABLE import_rows
ADD COLUMN IF NOT EXISTS brand VARCHAR(100);


ALTER TABLE import_rows
ADD COLUMN IF NOT EXISTS product_offer_id INTEGER;


ALTER TABLE import_rows
ADD CONSTRAINT import_rows_product_offer_fk
FOREIGN KEY (product_offer_id)
REFERENCES product_offers(id)
ON DELETE SET NULL;


CREATE INDEX IF NOT EXISTS
idx_import_rows_article
ON import_rows(article);


CREATE INDEX IF NOT EXISTS
idx_import_rows_product_offer
ON import_rows(product_offer_id);


COMMIT;