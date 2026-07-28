import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import {
  requireAuth,
  requireRole,
} from "./middleware/auth.middleware.js";

import { pool } from "./config/db.js";
import { searchRouter } from "./routes/search.routes.js";
import { cartRouter } from "./routes/cart.routes.js";
import { checkoutRouter } from "./routes/checkout.routes.js";
import { managerOrderRouter } from "./routes/manager-order.routes.js";
import { adminWarehouseRouter } from "./routes/admin-warehouse.routes.js";
import { adminSupplierRouter } from "./routes/admin-supplier.routes.js";
import { adminBrandRouter } from "./routes/admin-brand.routes.js";
import { adminSearchAnalyticsRouter } from "./routes/admin-search-analytics.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import {
  deliveryProfileRouter,
} from "./routes/delivery-profile.routes.js";

import { adminImportSettingsRouter }
from "./routes/admin-import-settings.routes.js";

import { adminImportRouter }
from "./routes/admin-import.routes.js";

import adminEmailImportRouter
from "./routes/admin-email-import.routes.js";

import { adminWarehouseOfferRouter }
from "./routes/admin-warehouse-offer.routes.js";

import {
  siteLanguageRouter,
  adminSiteLanguageRouter,
} from "./routes/site-language.routes.js";

import {
  sitePickupWarehouseRouter,
} from "./routes/site-pickup-warehouse.routes.js";

import {
  productTranslationRouter,
} from "./routes/product-translation.routes.js";

import adminAutomaticTranslationRoutes
  from "./routes/admin-automatic-translation.routes.js";

export const app = express();

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  "http://localhost:3000"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error(
          `Origin ${origin} не разрешён CORS`
        )
      );
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/account", deliveryProfileRouter);

app.use(
  "/api/admin",
  requireAuth,
  requireRole("ADMIN")
);

app.use(
  "/api/admin/automatic-translations",
  adminAutomaticTranslationRoutes
);

app.use(
  "/api/admin/products",
  productTranslationRouter
);

app.use(
  "/api/site/languages",
  siteLanguageRouter
);

app.use(
  "/api/site/pickup-warehouses",
  sitePickupWarehouseRouter
);

app.use(
  "/api/admin/site-languages",
  adminSiteLanguageRouter
);

app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "AutoHub server works",
  });
});

app.get("/test", async (req, res) => {
  try {
    const result =
      await pool.query("SELECT version();");

    res.json({
      status: "OK",
      database:
        result.rows[0].version,
    });
  } catch (error) {
    console.error(
      "Ошибка подключения к PostgreSQL:",
      error
    );

    res.status(500).json({
      status: "ERROR",
      error: error.message,
    });
  }
});

app.use("/api/search", searchRouter);
app.use("/api/cart", cartRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/manager/orders", managerOrderRouter);
app.use("/api/admin/warehouses", adminWarehouseRouter);
app.use("/api/admin/warehouses", adminWarehouseOfferRouter);
app.use("/api/admin/suppliers", adminSupplierRouter);
app.use("/api/admin/brands", adminBrandRouter);
app.use("/api/admin/search-analytics", adminSearchAnalyticsRouter);
app.use("/api/admin", adminImportSettingsRouter);
app.use("/api/admin/import", adminImportRouter);
app.use("/api/admin/email-import", adminEmailImportRouter);
