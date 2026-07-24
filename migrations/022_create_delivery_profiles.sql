BEGIN;

CREATE TABLE IF NOT EXISTS user_delivery_profiles (
  id SERIAL PRIMARY KEY,

  user_id INTEGER NOT NULL UNIQUE
    REFERENCES users(id)
    ON DELETE CASCADE,

  recipient_first_name VARCHAR(100),
  recipient_last_name VARCHAR(100),
  recipient_phone VARCHAR(50),
  recipient_email VARCHAR(150),

  delivery_method VARCHAR(40) NOT NULL DEFAULT 'PICKUP',

  pickup_warehouse_id INTEGER
    REFERENCES warehouses(id)
    ON DELETE SET NULL,

  nova_poshta_city_ref VARCHAR(100),
  nova_poshta_city_name VARCHAR(200),

  nova_poshta_point_type VARCHAR(20),
  nova_poshta_point_ref VARCHAR(100),
  nova_poshta_point_number VARCHAR(50),
  nova_poshta_point_name VARCHAR(255),
  nova_poshta_point_address TEXT,

  nova_poshta_street_ref VARCHAR(100),
  nova_poshta_street_name VARCHAR(200),
  nova_poshta_building VARCHAR(50),
  nova_poshta_apartment VARCHAR(50),
  courier_comment TEXT,

  created_at TIMESTAMP WITHOUT TIME ZONE
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP WITHOUT TIME ZONE
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT user_delivery_profiles_method_check
    CHECK (
      delivery_method IN (
        'PICKUP',
        'NOVA_POSHTA_POINT',
        'NOVA_POSHTA_COURIER'
      )
    ),

  CONSTRAINT user_delivery_profiles_point_type_check
    CHECK (
      nova_poshta_point_type IS NULL
      OR nova_poshta_point_type IN (
        'BRANCH',
        'LOCKER'
      )
    )
);


CREATE TABLE IF NOT EXISTS order_delivery_details (
  id SERIAL PRIMARY KEY,

  order_id INTEGER NOT NULL UNIQUE
    REFERENCES orders(id)
    ON DELETE CASCADE,

  delivery_method VARCHAR(40) NOT NULL,

  recipient_first_name VARCHAR(100) NOT NULL,
  recipient_last_name VARCHAR(100),
  recipient_phone VARCHAR(50) NOT NULL,
  recipient_email VARCHAR(150),

  pickup_warehouse_id INTEGER
    REFERENCES warehouses(id)
    ON DELETE SET NULL,

  nova_poshta_city_ref VARCHAR(100),
  nova_poshta_city_name VARCHAR(200),

  nova_poshta_point_type VARCHAR(20),
  nova_poshta_point_ref VARCHAR(100),
  nova_poshta_point_number VARCHAR(50),
  nova_poshta_point_name VARCHAR(255),
  nova_poshta_point_address TEXT,

  nova_poshta_street_ref VARCHAR(100),
  nova_poshta_street_name VARCHAR(200),
  nova_poshta_building VARCHAR(50),
  nova_poshta_apartment VARCHAR(50),
  courier_comment TEXT,

  created_at TIMESTAMP WITHOUT TIME ZONE
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT order_delivery_details_method_check
    CHECK (
      delivery_method IN (
        'PICKUP',
        'NOVA_POSHTA_POINT',
        'NOVA_POSHTA_COURIER'
      )
    ),

  CONSTRAINT order_delivery_details_point_type_check
    CHECK (
      nova_poshta_point_type IS NULL
      OR nova_poshta_point_type IN (
        'BRANCH',
        'LOCKER'
      )
    )
);


CREATE INDEX IF NOT EXISTS
  idx_order_delivery_details_method
ON order_delivery_details (
  delivery_method
);


CREATE INDEX IF NOT EXISTS
  idx_order_delivery_details_city_ref
ON order_delivery_details (
  nova_poshta_city_ref
);


COMMIT;
