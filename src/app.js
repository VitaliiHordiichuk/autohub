import express from "express";

import { pool } from "./config/db.js";
import { searchRouter } from "./routes/search.routes.js";
import { cartRouter } from "./routes/cart.routes.js";
import { checkoutRouter } from "./routes/checkout.routes.js";
import { managerOrderRouter } from "./routes/manager-order.routes.js";

export const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "AutoHub server works",
  });
});

app.get("/test", async (req, res) => {
  try {
    const result = await pool.query("SELECT version();");

    res.json({
      status: "OK",
      database: result.rows[0].version,
    });
  } catch (error) {
    console.error("Ошибка подключения к PostgreSQL:", error);

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