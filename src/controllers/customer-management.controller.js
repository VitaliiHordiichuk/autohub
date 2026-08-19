import { CustomerManagementService } from "../services/CustomerManagementService.js";
import { PasswordResetService } from "../services/PasswordResetService.js";

function fail(res, error) {
  console.error("Ошибка управления клиентами:", error);
  return res.status(Number(error.statusCode) || 400).json({
    success: false,
    code: error.code || undefined,
    error: error.message,
  });
}

export async function getCustomerPricingAccess(req, res, next) {
  try {
    const allowed = await CustomerManagementService.hasPricingAccess(
      req.auth.userId,
      req.auth.role
    );
    return res.json({ success: true, allowed, role: req.auth.role });
  } catch (error) {
    return next(error);
  }
}

export async function getPriceGroups(req, res) {
  try { return res.json({ success: true, priceGroups: await CustomerManagementService.getPriceGroups() }); }
  catch (error) { return fail(res, error); }
}

export async function getCustomers(req, res) {
  try { return res.json({ success: true, customers: await CustomerManagementService.getCustomers(req.query.search) }); }
  catch (error) { return fail(res, error); }
}

export async function getNextCustomerNumber(req, res) {
  try {
    return res.json({
      success: true,
      ...(await CustomerManagementService.getNextCustomerNumber()),
    });
  } catch (error) {
    return fail(res, error);
  }
}

export async function createCustomer(req, res) {
  try {
    const customer = await CustomerManagementService.createCustomer(req.body, {
      userId: req.auth.userId,
      role: req.auth.role,
    });
    return res.status(201).json({ success: true, customer });
  } catch (error) {
    return fail(res, error);
  }
}

export async function getCustomer(req, res) {
  try {
    return res.json({
      success: true,
      ...(await CustomerManagementService.getCustomer(req.params.customerId)),
    });
  } catch (error) {
    return fail(res, error);
  }
}

export async function updateCustomerNumber(req, res) {
  try {
    const customer = await CustomerManagementService.updateCustomerNumber({
      customerId: req.params.customerId,
      customerNumber: req.body?.customerNumber,
      changedBy: req.auth.userId,
    });
    return res.json({ success: true, customer });
  } catch (error) {
    return fail(res, error);
  }
}

export async function resetCustomerPassword(req, res) {
  try {
    const result = await PasswordResetService.resetCustomerByStaff({
      customerId: req.params.customerId,
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      locale: req.body?.locale,
      ipAddress: req.ip,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error);
  }
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
