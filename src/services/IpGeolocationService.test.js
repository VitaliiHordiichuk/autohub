import assert from "node:assert/strict";
import test from "node:test";

import {
  createIpGeolocationService,
  isPublicIpAddress,
} from "./IpGeolocationService.js";


test("external geolocation is limited to public IP addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "192.168.1.1",
    "203.0.113.5",
    "::1",
    "fd00::1",
    "2001:db8::1",
    "not-an-ip",
  ]) {
    assert.equal(isPublicIpAddress(ip), false, ip);
  }

  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2001:4860:4860::8888"), true);
});


test("city lookup uses bearer authentication and caches a successful response", async () => {
  const calls = [];
  const service = createIpGeolocationService({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });

      return {
        ok: true,
        async json() {
          return {
            city_name: "Mountain View",
            country_code: "us",
          };
        },
      };
    },
  });

  const first = await service.lookup("8.8.8.8");
  const second = await service.lookup("8.8.8.8");

  assert.deepEqual(first, {
    city: "Mountain View",
    countryCode: "US",
  });
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /ip=8\.8\.8\.8/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
});


test("city lookup stays optional and fails closed", async () => {
  let calls = 0;
  const disabled = createIpGeolocationService({
    enabled: false,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not be called");
    },
  });

  assert.equal(await disabled.lookup("8.8.8.8"), null);
  assert.equal(calls, 0);

  const unavailable = createIpGeolocationService({
    fetchImpl: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.equal(await unavailable.lookup("8.8.8.8"), null);
});


test("concurrent lookups for one IP share a single request", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });

  const service = createIpGeolocationService({
    fetchImpl: async () => {
      calls += 1;
      await pending;

      return {
        ok: true,
        async json() {
          return {
            city_name: "Kyiv",
            country_code: "UA",
          };
        },
      };
    },
  });

  const first = service.lookup("8.8.4.4");
  const second = service.lookup("8.8.4.4");
  release();

  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
});
