BEGIN;


CREATE TABLE IF NOT EXISTS price_history (

    id BIGSERIAL PRIMARY KEY,


    product_offer_id INTEGER NOT NULL
        REFERENCES product_offers(id)
        ON DELETE CASCADE,


    old_price NUMERIC(12,2),

    new_price NUMERIC(12,2)
        NOT NULL,


    change_percent NUMERIC(8,2),


    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

);


CREATE INDEX IF NOT EXISTS idx_price_history_offer
ON price_history(product_offer_id);


CREATE INDEX IF NOT EXISTS idx_price_history_created
ON price_history(created_at);


COMMIT;