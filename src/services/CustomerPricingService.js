import { pool } from "../config/db.js";
import { WarehousePricingService } from "./WarehousePricingService.js";

function normalizeRetailPrice(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function normalizeMinimumSalePrice(value, retailPrice) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return retailPrice;
  }

  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

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
        (ep.user_id IS NOT NULL AND ep.access_enabled=TRUE
          AND ep.removed_at IS NULL) AS active_staff,
        c.id AS customer_id,
        pg.name,
        pg.discount_percent,
        pg.pricing_mode
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN employee_profiles ep ON ep.user_id = u.id
      LEFT JOIN customers c
        ON c.user_id = u.id
        AND c.is_active = TRUE
      LEFT JOIN price_groups pg ON pg.id = c.price_group_id
      WHERE u.id = $1 AND u.is_active = TRUE
      LIMIT 1`, [userId]);
    const row = result.rows[0];

    const priceGroups = row?.active_staff
        ? (await db.query(`
            SELECT id, name, discount_percent, pricing_mode
            FROM price_groups
            ORDER BY
              CASE UPPER(name)
                WHEN 'REGISTERED' THEN 1
                WHEN 'GOLD' THEN 2
                WHEN 'VIP' THEN 3
                ELSE 4
              END,
              id
          `)).rows.map((group) => ({
            id: Number(group.id),
            name: group.name,
            discountPercent: Number(group.discount_percent),
            pricingMode: group.pricing_mode,
          }))
        : [];
    const staffPresentation = {showAllPrices:Boolean(row?.active_staff),priceGroups};
    if (!row || (row.role_name !== "CLIENT" && !row.customer_id)) {
      return {discountPercent:0,isVip:false,priceGroupName:"Guest",...staffPresentation};
    }

    if (!row.customer_id) {
      return {
        discountPercent: 5,
        isVip: false,
        priceGroupName: "Registered",
        ...staffPresentation,
      };
    }

    return {
      discountPercent: Number(row.discount_percent ?? 5),
      isVip: row.pricing_mode === "MINIMUM",
      priceGroupName: row.name || "Registered",
      ...staffPresentation,
    };
  },

  price({ retailPrice, minimumSalePrice }, context) {
    const retail = normalizeRetailPrice(retailPrice);
    if (retail === null) return null;

    const minimum = normalizeMinimumSalePrice(minimumSalePrice, retail);
    if (minimum === null) return null;

    return WarehousePricingService.calculateCustomerPrice({
      retailPrice: retail,
      minimumSalePrice: minimum,
      discountPercent: context?.discountPercent ?? 0,
      isVip: context?.isVip === true,
    });
  },

  priceMatrix({ retailPrice, minimumSalePrice }, context) {
    if (context?.showAllPrices !== true) return null;

    const retail = normalizeRetailPrice(retailPrice);
    if (retail === null) return null;

    const minimum = normalizeMinimumSalePrice(minimumSalePrice, retail);
    if (minimum === null) return null;

    const rows = [];

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
