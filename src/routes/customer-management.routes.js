import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { CustomerManagementService } from "../services/CustomerManagementService.js";
import {
  getCustomerPricingAccess, getCustomers, getManagers, getPriceGroups,
  setCustomerPriceGroup, setManagerPricingPermission,
} from "../controllers/customer-management.controller.js";

export const customerManagementRouter = Router();

customerManagementRouter.use(requireAuth, requireRole("ADMIN", "MANAGER"));
customerManagementRouter.use(async (req, res, next) => {
  try {
    const allowed = await CustomerManagementService.hasPricingAccess(
      req.auth.userId, req.auth.role);
    if (!allowed) return res.status(403).json({ success: false, error: "Нет права управлять ценами клиентов" });
    return next();
  } catch (error) { return next(error); }
});

customerManagementRouter.get("/access", getCustomerPricingAccess);
customerManagementRouter.get("/price-groups", getPriceGroups);
customerManagementRouter.get("/customers", getCustomers);
customerManagementRouter.patch("/customers/:customerId/price-group", setCustomerPriceGroup);
customerManagementRouter.get("/managers", requireRole("ADMIN"), getManagers);
customerManagementRouter.patch("/managers/:userId/pricing-permission", requireRole("ADMIN"), setManagerPricingPermission);
