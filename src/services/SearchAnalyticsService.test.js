import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSearchLocation,
  shouldRecordSearchAnalytics,
  isMeaningfulSearchQuery,
} from "./SearchAnalyticsService.js";

test("crawler and prefetch traffic does not become customer searches", () => {
  for (const userAgent of ["Googlebot/2.1", "Google-InspectionTool/1.0", "bingbot/2.0", "Mozilla HeadlessChrome/130", "facebookexternalhit/1.1"]) {
    assert.equal(shouldRecordSearchAnalytics({ headers: { "user-agent": userAgent } }), false, userAgent);
  }
  assert.equal(shouldRecordSearchAnalytics({ headers: { "user-agent": "Mozilla/5.0 Chrome/130 Safari/537.36" } }), true);
  assert.equal(shouldRecordSearchAnalytics({ headers: { "sec-purpose": "prefetch;prerender" } }), false);
  for (const value of [null, undefined, "null", " NULL ", "undefined", "", "  ", {}, ["A123"], "a".repeat(256)]) {
    assert.equal(isMeaningfulSearchQuery(value), false);
  }
  assert.equal(isMeaningfulSearchQuery("колодки"), true);
  assert.equal(isMeaningfulSearchQuery("A2711800109"), true);
});


test("trusted location headers take priority", () => {
  const result = resolveSearchLocation({
    headers: {
      "x-forwarded-for": "8.8.8.8",
      "x-vercel-ip-city": "Kyiv",
      "x-vercel-ip-country": "ua",
    },
  });

  assert.deepEqual(result, {
    clientIp: "8.8.8.8",
    city: "Kyiv",
    countryCode: "UA",
  });
});


test("local addresses do not invent a location", () => {
  const result = resolveSearchLocation({
    headers: {},
    socket: {
      remoteAddress: "::ffff:127.0.0.1",
    },
  });

  assert.deepEqual(result, {
    clientIp: "127.0.0.1",
    city: null,
    countryCode: null,
  });
});


test("Express proxy IP takes priority over raw forwarding headers", () => {
  const result = resolveSearchLocation({
    ip: "::ffff:8.8.8.8",
    headers: {
      "x-forwarded-for": "203.0.113.5, 127.0.0.1",
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
  });

  assert.equal(
    result.clientIp,
    "8.8.8.8"
  );
});


test("Nginx real IP takes priority over its loopback connection", () => {
  const result = resolveSearchLocation({
    ip: "127.0.0.1",
    headers: {
      "x-real-ip": "8.8.8.8",
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
  });

  assert.equal(
    result.clientIp,
    "8.8.8.8"
  );
});


test("Cloudflare location headers are recognized", () => {
  const result = resolveSearchLocation({
    headers: {
      "cf-connecting-ip": "8.8.8.8",
      "cf-ipcity": "Kyiv",
      "cf-ipcountry": "ua",
    },
  });

  assert.deepEqual(result, {
    clientIp: "8.8.8.8",
    city: "Kyiv",
    countryCode: "UA",
  });
});


test("staff searches are excluded from analytics", () => {
  assert.equal(
    shouldRecordSearchAnalytics({
      auth: { role: "ADMIN" },
    }),
    false
  );

  assert.equal(
    shouldRecordSearchAnalytics({
      auth: { role: "MANAGER" },
    }),
    false
  );

  assert.equal(
    shouldRecordSearchAnalytics({
      auth: { role: "CLIENT" },
    }),
    true
  );

  assert.equal(
    shouldRecordSearchAnalytics({}),
    true
  );
});
