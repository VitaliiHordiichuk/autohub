import { EmployeeAdminService } from "../services/EmployeeAdminService.js";

function fail(res, error) {
  console.error("Ошибка управления сотрудниками:", error);
  return res.status(400).json({ success: false, error: error.message });
}

export async function getEmployees(req, res) {
  try { return res.json({ success: true, employees: await EmployeeAdminService.list() }); }
  catch (error) { return fail(res, error); }
}

export async function createEmployee(req, res) {
  try {
    const employee = await EmployeeAdminService.create(req.body, req.auth.userId);
    return res.status(201).json({ success: true, employee });
  } catch (error) { return fail(res, error); }
}

export async function setEmployeeActive(req, res) {
  try {
    const employee = await EmployeeAdminService.setActive(
      req.params.employeeId,req.body.isActive,req.auth.userId);
    return res.json({ success: true, employee });
  } catch (error) { return fail(res, error); }
}

export async function resetEmployeePassword(req, res) {
  try {
    await EmployeeAdminService.resetPassword(req.params.employeeId, req.body.password,req.auth.userId);
    return res.json({ success: true });
  } catch (error) { return fail(res, error); }
}

export async function setEmployeePricingPermission(req, res) {
  try {
    const permission = await EmployeeAdminService.setPricingPermission(
      req.params.employeeId, req.body.enabled, req.auth.userId);
    return res.json({ success: true, permission });
  } catch (error) { return fail(res, error); }
}

export async function setEmployeeTelegramAllowed(req,res) {
  try {
    const employee = await EmployeeAdminService.setTelegramAllowed(
      req.params.employeeId,req.body.enabled,req.auth.userId);
    return res.json({success:true,employee});
  } catch(error) { return fail(res,error); }
}

export async function setEmployeeOrderNotifications(req,res) {
  try {
    const employee = await EmployeeAdminService.setOrderNotifications(
      req.params.employeeId,req.body.enabled,req.auth.userId);
    return res.json({success:true,employee});
  } catch(error) { return fail(res,error); }
}

export async function createEmployeeTelegramLink(req,res) {
  try {
    const link = await EmployeeAdminService.createTelegramLink(
      req.params.employeeId,req.auth.userId);
    res.setHeader("Cache-Control","no-store");
    return res.json({success:true,...link});
  } catch(error) { return fail(res,error); }
}

export async function unlinkEmployeeTelegram(req,res) {
  try {
    const employee = await EmployeeAdminService.unlinkTelegram(
      req.params.employeeId,req.auth.userId);
    return res.json({success:true,employee});
  } catch(error) { return fail(res,error); }
}

export async function resetEmployeeWorkAccess(req,res) {
  try {
    const employee = await EmployeeAdminService.resetWorkAccess(
      req.params.employeeId,req.auth.userId);
    return res.json({success:true,employee});
  } catch(error) { return fail(res,error); }
}

export async function removeEmployee(req,res) {
  try {
    const employee = await EmployeeAdminService.remove(
      req.params.employeeId,req.auth.userId);
    return res.json({success:true,employee});
  } catch(error) { return fail(res,error); }
}
