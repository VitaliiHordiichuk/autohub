import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSearchLocation,
} from "./SearchAnalyticsService.js";


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
