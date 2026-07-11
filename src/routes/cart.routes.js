import { Router } from "express";

import { addCartItem } from "../controllers/cart.controller.js";

export const cartRouter = Router();

cartRouter.post("/items", addCartItem);