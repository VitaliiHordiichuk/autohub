import { Router } from "express";
import {
  createEmployee, getEmployees, resetEmployeePassword,
  setEmployeeActive, setEmployeePricingPermission,
  setEmployeeTelegramAllowed,setEmployeeOrderNotifications,
  createEmployeeTelegramLink,unlinkEmployeeTelegram,
  resetEmployeeWorkAccess,removeEmployee,
} from "../controllers/admin-employee.controller.js";

export const adminEmployeeRouter = Router();
adminEmployeeRouter.get("/", getEmployees);
adminEmployeeRouter.post("/", createEmployee);
adminEmployeeRouter.patch("/:employeeId/active", setEmployeeActive);
adminEmployeeRouter.patch("/:employeeId/password", resetEmployeePassword);
adminEmployeeRouter.patch("/:employeeId/customer-pricing-permission", setEmployeePricingPermission);
adminEmployeeRouter.patch("/:employeeId/staff-telegram",setEmployeeTelegramAllowed);
adminEmployeeRouter.patch("/:employeeId/order-notifications",setEmployeeOrderNotifications);
adminEmployeeRouter.post("/:employeeId/staff-telegram/link",createEmployeeTelegramLink);
adminEmployeeRouter.delete("/:employeeId/staff-telegram/link",unlinkEmployeeTelegram);
adminEmployeeRouter.post("/:employeeId/reset-work-access",resetEmployeeWorkAccess);
adminEmployeeRouter.delete("/:employeeId",removeEmployee);
