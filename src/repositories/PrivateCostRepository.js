import { pool } from "../config/db.js";

// Store private unit cost in a separate relation; public product_offers SELECT *
// never includes the true purchasing cost.
export const PrivateCostRepository={
  async upsert(productOfferId,unitCost,db=pool){
    await db.query(`
      INSERT INTO product_offer_internal_costs
        (product_offer_id,unit_cost,updated_at)
      VALUES($1,$2::numeric,CURRENT_TIMESTAMP)
      ON CONFLICT(product_offer_id) DO UPDATE SET
        unit_cost=EXCLUDED.unit_cost,updated_at=CURRENT_TIMESTAMP
    `,[productOfferId,unitCost]);
  },
};
