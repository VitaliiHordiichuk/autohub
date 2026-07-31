import { pool } from "../config/db.js";
import { WarehousePricingService } from "./WarehousePricingService.js";

export const CustomerPricingService = {
  async getContext(userId, db = pool) {
    if (!userId) {
      return {
        discountPercent: 0,
        isVip: false,
        priceGroupName: "Guest",
      };
    }

    const result = await db.query(`
      SELECT
        r.name AS role_name,
        c.id AS customer_id,
        pg.name,
        pg.discount_percent,
        pg.pricing_mode
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN customers c
        ON c.user_id = u.id
        AND c.is_active = TRUE
      LEFT JOIN price_groups pg ON pg.id = c.price_group_id
      WHERE u.id = $1 AND u.is_active = TRUE
      LIMIT 1`, [userId]);
    const row = result.rows[0];

    if (!row || row.role_name !== "CLIENT") {
      const priceGroups = row
        ? (await db.query(`
            SELECT id, name, discount_percent, pricing_mode
            FROM price_groups
            ORDER BY discount_percent, id
          `)).rows.map((group) => ({
            id: Number(group.id),
            name: group.name,
            discountPercent: Number(group.discount_percent),
            pricingMode: group.pricing_mode,
          }))
        : [];

      return {
        discountPercent: 0,
        isVip: false,
        priceGroupName: "Guest",
        showAllPrices: Boolean(row),
        priceGroups,
      };
    }

    if (!row.customer_id) {
      return {
        discountPercent: 5,
        isVip: false,
        priceGroupName: "Registered",
      };
    }

    return {
      discountPercent: Number(row.discount_percent ?? 5),
      isVip: row.pricing_mode === "MINIMUM",
      priceGroupName: row.name || "Registered",
    };
  },

  price({ retailPrice, minimumSalePrice }, context) {
    if (retailPrice === null || retailPrice === undefined) return null;
    const minimum = minimumSalePrice ?? retailPrice;
    return WarehousePricingService.calculateCustomerPrice({
      retailPrice,
      minimumSalePrice: minimum,
      discountPercent: context?.discountPercent ?? 0,
      isVip: context?.isVip === true,
    });
  },

  priceMatrix({ retailPrice, minimumSalePrice }, context) {
    if (context?.showAllPrices !== true) return null;

    const retail = Number(retailPrice);
    const minimum = Number(minimumSalePrice ?? retailPrice);

    if (!Number.isFinite(retail) || !Number.isFinite(minimum)) return null;

    const rows = [{
      key: "RETAIL",
      name: "Розница",
      price: Number(retail.toFixed(2)),
    }];

    for (const group of context.priceGroups || []) {
      if (
        group.pricingMode !== "MINIMUM" &&
        Number(group.discountPercent) === 0
      ) {
        continue;
      }

      const pricing = WarehousePricingService.calculateCustomerPrice({
        retailPrice: retail,
        minimumSalePrice: minimum,
        discountPercent: group.discountPercent,
        isVip: group.pricingMode === "MINIMUM",
      });

      rows.push({
        key: `GROUP:${group.id}`,
        name: group.name,
        price: Number(pricing.customerPrice.toFixed(2)),
        pricingMode: group.pricingMode,
        discountPercent: group.discountPercent,
      });
    }

    return rows;
  },
};
