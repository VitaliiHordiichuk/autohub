import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";

import { app } from "../../src/app.js";
import { pool } from "../../src/config/db.js";
import { GoogleMerchantFeedService } from "../../src/services/GoogleMerchantFeedService.js";
import { renderGoogleMerchantFeed } from "../../src/services/GoogleMerchantFeedService.js";


let server;
let baseUrl;
const originalGenerateXml = GoogleMerchantFeedService.generateXml;


before(async () => {
  server = app.listen(0);
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});


afterEach(() => {
  GoogleMerchantFeedService.generateXml = originalGenerateXml;
});


after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
  await pool.end();
});


test("public endpoint returns an RSS XML product feed", async () => {
  GoogleMerchantFeedService.generateXml = async () =>
    renderGoogleMerchantFeed([{
      id: "maka-101",
      title: "MANN-FILTER Фільтр масляний HU718/5X",
      description: "Фільтр масляний.",
      link: "https://maka.com.ua/uk/product/HU718%2F5X",
      imageLink: "https://images.example.test/101.webp",
      additionalImageLinks: [],
      availability: "in_stock",
      price: "1380.96 UAH",
      condition: "new",
      brand: "MANN-FILTER",
      mpn: "HU718/5X",
    }]);

  const response = await fetch(
    `${baseUrl}/api/google/merchant-feed.xml`
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type"),
    /^application\/rss\+xml; charset=utf-8$/i
  );
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  assert.match(body, /<rss[\s>]/);
  assert.match(body, /<channel>/);
  assert.match(body, /<item>/);
  assert.doesNotMatch(body, /<!doctype html>|<html[\s>]/i);
});


test("endpoint hides internal error details", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  GoogleMerchantFeedService.generateXml = async () => {
    throw new Error("database password=top-secret");
  };

  try {
    const response = await fetch(
      `${baseUrl}/api/google/merchant-feed.xml`
    );
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.match(response.headers.get("content-type"), /^text\/plain/i);
    assert.equal(body, "Google Merchant feed is temporarily unavailable");
    assert.doesNotMatch(body, /top-secret|password|stack/i);
    assert.doesNotMatch(body, /<html[\s>]/i);
  } finally {
    console.error = originalConsoleError;
  }
});
