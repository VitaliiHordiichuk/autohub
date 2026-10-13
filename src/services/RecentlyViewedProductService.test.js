import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRecentlyViewedItems,
  RECENTLY_VIEWED_LIMIT,
} from "./RecentlyViewedProductService.js";

const NOW = new Date("2026-10-12T12:00:00.000Z");

test("recently viewed input is normalized, deduplicated and ordered by newest view", () => {
  const items = normalizeRecentlyViewedItems([
    { article: " A 167-350 ", viewedAt: NOW.getTime() - 1_000 },
    { article: "a167350", viewedAt: NOW.getTime() },
    { article: "B 123", viewedAt: NOW.getTime() - 500 },
  ], NOW);
  assert.deepEqual(items.map((item) => item.article), ["A167350", "B123"]);
  assert.equal(items[0].viewedAt.toISOString(), NOW.toISOString());
});

test("expired, invalid and implausibly future views are ignored", () => {
  const items = normalizeRecentlyViewedItems([
    { article: "OLD", viewedAt: NOW.getTime() - 31 * 24 * 60 * 60 * 1000 },
    { article: "FUTURE", viewedAt: NOW.getTime() + 6 * 60 * 1000 },
    { article: "", viewedAt: NOW.getTime() },
    { article: "CURRENT", viewedAt: NOW.getTime() },
  ], NOW);
  assert.deepEqual(items.map((item) => item.article), ["CURRENT"]);
});

test("recently viewed payload is strictly bounded", () => {
  assert.throws(() => normalizeRecentlyViewedItems(
    Array.from({ length: RECENTLY_VIEWED_LIMIT + 1 }, (_, index) => ({
      article: `A${index}`,
      viewedAt: NOW.getTime() - index,
    })),
    NOW,
  ), /не більше 12/);
});
