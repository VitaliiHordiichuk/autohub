import { CustomerManagementService } from "../services/CustomerManagementService.js";

function fail(res, error) {
  console.error("Ошибка управления клиентами:", error);
  return res.status(400).json({ success: false, error: error.message });
}

export async function getCustomerPricingAccess(req, res) {
  return res.json({ success: true, allowed: true, role: req.auth.role });
}

export async function getPriceGroups(req, res) {
  try { return res.json({ success: true, priceGroups: await CustomerManagementService.getPriceGroups() }); }
  catch (error) { return fail(res, error); }
}

export async function getCustomers(req, res) {
  try { return res.json({ success: true, customers: await CustomerManagementService.getCustomers(req.query.search) }); }
  catch (error) { return fail(res, error); }
}

export async function setCustomerPriceGroup(req, res) {
  try {
    const customer = await CustomerManagementService.setPriceGroup({
      customerId: req.params.customerId,
      priceGroupId: req.body.priceGroupId,
      changedBy: req.auth.userId,
    });
    return res.json({ success: true, customer });
  } catch (error) { return fail(res, error); }
}

export async function getManagers(req, res) {
  try { return res.json({ success: true, managers: await CustomerManagementService.getManagers() }); }
  catch (error) { return fail(res, error); }
}

export async function setManagerPricingPermission(req, res) {
  try {
    const permission = await CustomerManagementService.setManagerPermission({
      managerUserId: req.params.userId,
      enabled: req.body.enabled === true,
      grantedBy: req.auth.userId,
    });
    return res.json({ success: true, permission });
  } catch (error) { return fail(res, error); }
}
