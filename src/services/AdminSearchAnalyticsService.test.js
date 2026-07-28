import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAnalyticsQuery,
} from "./AdminSearchAnalyticsService.js";


test(
  "нормализует фильтры поисковой аналитики",
  () => {
    assert.deepEqual(
      normalizeAnalyticsQuery({
        days: "90",
        status: "not_found",
        search: "  A271  ",
        page: "3",
        limit: "50",
      }),
      {
        days: 90,
        status: "NOT_FOUND",
        search: "A271",
        page: 3,
        limit: 50,
      }
    );
  }
);


test(
  "использует безопасные значения аналитики по умолчанию",
  () => {
    assert.deepEqual(
      normalizeAnalyticsQuery({
        days: "999",
        status: "wrong",
        page: "-2",
        limit: "1000",
      }),
      {
        days: 30,
        status: "ALL",
        search: "",
        page: 1,
        limit: 25,
      }
    );
  }
);
