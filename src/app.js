import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import {
  requireAuth,
  requireRole,
} from "./middleware/auth.middleware.js";

import { pool } from "./config/db.js";
import { searchRouter } from "./routes/search.routes.js";
import { catalogRouter } from "./routes/catalog.routes.js";
import { cartRouter } from "./routes/cart.routes.js";
import { checkoutRouter } from "./routes/checkout.routes.js";
import { managerOrderRouter } from "./routes/manager-order.routes.js";
import { adminWarehouseRouter } from "./routes/admin-warehouse.routes.js";
import { adminSupplierRouter } from "./routes/admin-supplier.routes.js";
import { adminBrandRouter } from "./routes/admin-brand.routes.js";
import { adminSearchAnalyticsRouter } from "./routes/admin-search-analytics.routes.js";
import { adminArticleNumberRouter } from "./routes/admin-article-number.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import {
  deliveryProfileRouter,
} from "./routes/delivery-profile.routes.js";

import {
  clientCartRouter,
} from "./routes/client-cart.routes.js";

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
import { customerManagementRouter } from "./routes/customer-management.routes.js";
import { adminEmployeeRouter } from "./routes/admin-employee.routes.js";
import { adminProductImageRouter } from "./routes/admin-product-image.routes.js";
import { adminProductRouter } from "./routes/admin-product.routes.js";
import { adminCatalogCategoryRouter } from "./routes/admin-catalog-category.routes.js";
import { clientSearchHistoryRouter } from "./routes/client-search-history.routes.js";
import { clientOrderRouter } from "./routes/client-order.routes.js";
import { notificationRouter } from "./routes/notification.routes.js";
import { telegramConnectionRouter } from "./routes/telegram-connection.routes.js";
import { clientVinRequestRouter, managerVinRequestRouter,publicVinBrandRouter,adminVinBrandRouter,adminVinSettingsRouter } from "./routes/vin-request.routes.js";
import {
  adminHomepageRouter,
  publicHomepageRouter,
} from "./routes/homepage-content.routes.js";
import { optionalAuthSilent } from "./middleware/auth.middleware.js";
import { enforceApiErrorLanguage } from "./middleware/api-error-language.middleware.js";
import { seoRouter } from "./routes/seo.routes.js";
import { productPlaceholderRouter } from "./routes/product-placeholder.routes.js";

export const app = express();

app.set(
  "trust proxy",
  process.env.TRUST_PROXY === "false" ? false : 1
);

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
app.use(enforceApiErrorLanguage);

app.use("/api/auth", authRouter);
app.use("/api/account", deliveryProfileRouter);
app.use("/api/account/search-history", clientSearchHistoryRouter);
app.use("/api/account/cart", clientCartRouter);
app.use("/api/account/orders", clientOrderRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/account/telegram", telegramConnectionRouter);
app.use("/api/account/vin-requests", clientVinRequestRouter);
app.use("/api/vin-vehicle-brands",publicVinBrandRouter);
app.use("/api/homepage", optionalAuthSilent, publicHomepageRouter);
app.use("/api/seo", seoRouter);
app.use("/api/products", productPlaceholderRouter);
app.use("/api/admin/products", adminProductRouter);

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
    message: "makahub server works",
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
app.use("/api/catalog", catalogRouter);
app.use("/api/cart", cartRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/manager/orders", managerOrderRouter);
app.use("/api/manager/vin-requests", managerVinRequestRouter);
app.use("/api/management", customerManagementRouter);
app.use("/api/admin/warehouses", adminWarehouseRouter);
app.use("/api/admin/warehouses", adminWarehouseOfferRouter);
app.use("/api/admin/suppliers", adminSupplierRouter);
app.use("/api/admin/brands", adminBrandRouter);
app.use("/api/admin/search-analytics", adminSearchAnalyticsRouter);
app.use("/api/admin/article-numbers", adminArticleNumberRouter);
app.use("/api/admin/employees", adminEmployeeRouter);
app.use("/api/admin/product-images", adminProductImageRouter);
app.use("/api/admin/catalog", adminCatalogCategoryRouter);
app.use("/api/admin/vin-vehicle-brands",adminVinBrandRouter);
app.use("/api/admin/vin-settings",adminVinSettingsRouter);
app.use("/api/admin/homepage", adminHomepageRouter);
app.use("/api/admin", adminImportSettingsRouter);
app.use("/api/admin/import", adminImportRouter);
app.use("/api/admin/email-import", adminEmailImportRouter);
