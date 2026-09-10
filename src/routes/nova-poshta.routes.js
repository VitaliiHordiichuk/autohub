import { Router } from "express";

import {
  searchNovaPoshtaCities,
  searchNovaPoshtaPoints,
} from "../controllers/nova-poshta.controller.js";

export const novaPoshtaRouter = Router();

novaPoshtaRouter.get(
  "/cities",
  searchNovaPoshtaCities
);

novaPoshtaRouter.get(
  "/points",
  searchNovaPoshtaPoints
);

