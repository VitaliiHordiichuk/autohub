import {
  Router,
} from "express";

import {
  addManualWarehousePosition,
  getOfferPriceHistory,
  listWarehouseOffers,
  removeOfferUntilNextImport,
  resetAutomaticOfferPrice,
  setManualOfferPrice,
  setOfferVisibility,
} from "../controllers/admin-warehouse-offer.controller.js";


export const adminWarehouseOfferRouter =
  Router();


adminWarehouseOfferRouter.get(
  "/:warehouseId/offers",
  listWarehouseOffers
);


adminWarehouseOfferRouter.post(
  "/:warehouseId/offers/manual",
  addManualWarehousePosition
);


adminWarehouseOfferRouter.delete(
  "/:warehouseId/offers/:offerId",
  removeOfferUntilNextImport
);


adminWarehouseOfferRouter.patch(
  "/:warehouseId/offers/:offerId/manual-price",
  setManualOfferPrice
);


adminWarehouseOfferRouter.delete(
  "/:warehouseId/offers/:offerId/manual-price",
  resetAutomaticOfferPrice
);


adminWarehouseOfferRouter.patch(
  "/:warehouseId/offers/:offerId/visibility",
  setOfferVisibility
);


adminWarehouseOfferRouter.get(
  "/:warehouseId/offers/:offerId/price-history",
  getOfferPriceHistory
);
