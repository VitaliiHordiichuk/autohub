import { Router } from "express";
import {
  createEmployee, getEmployees, resetEmployeePassword,
  setEmployeeActive, setEmployeePricingPermission,
} from "../controllers/admin-employee.controller.js";

export const adminEmployeeRouter = Router();
adminEmployeeRouter.get("/", getEmployees);
adminEmployeeRouter.post("/", createEmployee);
adminEmployeeRouter.patch("/:employeeId/active", setEmployeeActive);
adminEmployeeRouter.patch("/:employeeId/password", resetEmployeePassword);
adminEmployeeRouter.patch("/:employeeId/customer-pricing-permission", setEmployeePricingPermission);
