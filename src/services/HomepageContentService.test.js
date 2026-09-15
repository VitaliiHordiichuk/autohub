import test from "node:test";
import assert from "node:assert/strict";

import {
  HomepageContentService,
  annualDateIsWithin,
  selectHomepageBanner,
} from "./HomepageContentService.js";

test("банер активного періоду має пріоритет над резервними", async () => {
  const scheduled = { id: 12, starts_on: "2026-08-24", ends_on: "2026-08-28" };
  let queryCount = 0;
  const db = {
    async query(sql) {
      queryCount += 1;
      if (sql.includes("FROM homepage_banner_daily_selections selection")) return { rows: [] };
      if (sql.includes("INSERT INTO homepage_banner_daily_selections")) {
        return { rows: [{ banner_id: scheduled.id }] };
      }
      return { rows: [scheduled] };
    },
  };

  assert.equal(await selectHomepageBanner("2026-08-25", db), scheduled);
  assert.equal(queryCount, 3);
});

test("поза активним періодом вибирається тільки банер без дат", async () => {
  const nextBanner = { id: 5 };
  let queryCount = 0;
  let insertValues = null;
  const db = {
    async query(sql, values) {
      queryCount += 1;
      if (sql.includes("FROM homepage_banner_daily_selections selection")) return { rows: [] };
      if (sql.includes("INSERT INTO homepage_banner_daily_selections")) {
        insertValues = values;
        return { rows: [{ banner_id: 5 }] };
      }
      if (sql.includes("WITH last_rotation")) return { rows: [nextBanner] };
      return { rows: [] };
    },
  };

  assert.equal(await selectHomepageBanner("2026-08-25", db), nextBanner);
  assert.equal(queryCount, 5);
  assert.deepEqual(insertValues, ["2026-08-25", 5, "ROTATION", 5]);
});

test("звичайна черга йде до наступного наявного номера і пропускає прогалини", async () => {
  let rotationQuery = "";
  let rotationValues = null;
  const db = {
    async query(sql, values) {
      if (sql.includes("FROM homepage_banner_daily_selections selection")) return { rows: [] };
      if (sql.includes("starts_on <= $1::date")) return { rows: [] };
      if (sql.includes("repeats_annually = TRUE")) return { rows: [] };
      if (sql.includes("WITH last_rotation")) {
        rotationQuery = sql;
        rotationValues = values;
        return { rows: [{ id: 7 }] };
      }
      if (sql.includes("INSERT INTO homepage_banner_daily_selections")) {
        return { rows: [{ banner_id: 7 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  assert.deepEqual(await selectHomepageBanner("2026-09-18", db), { id: 7 });
  assert.ok(rotationQuery.includes("banner.id > rotation.last_id"));
  assert.ok(rotationQuery.includes("banner.id"));
  assert.deepEqual(rotationValues, ["2026-09-18"]);
});

test("банер з датою не пересуває звичайну чергу", async () => {
  const scheduled = { id: 40 };
  let insertValues = null;
  const db = {
    async query(sql, values) {
      if (sql.includes("FROM homepage_banner_daily_selections selection")) return { rows: [] };
      if (sql.includes("starts_on <= $1::date")) return { rows: [scheduled] };
      if (sql.includes("INSERT INTO homepage_banner_daily_selections")) {
        insertValues = values;
        return { rows: [{ banner_id: scheduled.id }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  assert.equal(await selectHomepageBanner("2026-09-17", db), scheduled);
  assert.deepEqual(insertValues, ["2026-09-17", 40, "SCHEDULED", null]);
});

test("вибраний банер не змінюється протягом київської календарної дати", async () => {
  const stored = {
    daily_banner_id: 19,
    id: 19,
    title_uk: "Зафіксований факт дня",
  };
  let queryCount = 0;
  const db = {
    async query(sql, values) {
      queryCount += 1;
      assert.ok(sql.includes("FROM homepage_banner_daily_selections selection"));
      assert.deepEqual(values, ["2026-09-16"]);
      return { rows: [stored] };
    },
  };

  assert.equal(await selectHomepageBanner("2026-09-16", db), stored);
  assert.equal(await selectHomepageBanner("2026-09-16", db), stored);
  assert.equal(queryCount, 2);
});

test("одночасні запити використовують перший зафіксований банер", async () => {
  const candidate = { id: 2 };
  const concurrent = { daily_banner_id: 9, id: 9 };
  let dailyReads = 0;
  const db = {
    async query(sql) {
      if (sql.includes("FROM homepage_banner_daily_selections selection")) {
        dailyReads += 1;
        return { rows: dailyReads === 1 ? [] : [concurrent] };
      }
      if (sql.includes("INSERT INTO homepage_banner_daily_selections")) {
        return { rows: [] };
      }
      if (sql.includes("starts_on <= $1::date")) return { rows: [] };
      if (sql.includes("repeats_annually = TRUE")) return { rows: [] };
      if (sql.includes("WITH last_rotation")) return { rows: [candidate] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  assert.equal(await selectHomepageBanner("2026-09-16", db), concurrent);
  assert.equal(dailyReads, 2);
});

test("щорічний банер працює без прив'язки до року", async () => {
  assert.equal(annualDateIsWithin("2026-08-25", "2000-08-25", "2000-08-25"), true);
  assert.equal(annualDateIsWithin("2034-08-25", "2000-08-25", "2000-08-25"), true);
  assert.equal(annualDateIsWithin("2034-08-26", "2000-08-25", "2000-08-25"), false);
});

test("щорічний період може переходити через Новий рік", () => {
  assert.equal(annualDateIsWithin("2026-12-31", "2000-12-29", "2000-01-05"), true);
  assert.equal(annualDateIsWithin("2027-01-03", "2000-12-29", "2000-01-05"), true);
  assert.equal(annualDateIsWithin("2027-01-06", "2000-12-29", "2000-01-05"), false);
});

test("щорічний банер має пріоритет над резервною ротацією", async () => {
  const annual = {
    id: 18,
    starts_on: "2000-08-24",
    ends_on: "2000-08-26",
    repeats_annually: true,
  };
  let queryCount = 0;
  const db = {
    async query(sql) {
      queryCount += 1;
      if (sql.includes("FROM homepage_banner_daily_selections selection")) return { rows: [] };
      if (sql.includes("INSERT INTO homepage_banner_daily_selections")) {
        return { rows: [{ banner_id: annual.id }] };
      }
      return queryCount === 3 ? { rows: [annual] } : { rows: [] };
    },
  };

  assert.equal(await selectHomepageBanner("2032-08-25", db), annual);
  assert.equal(queryCount, 4);
});

test("період банера можна повністю очистити без видалення банера", async () => {
  const current = {
    id: 7,
    scheduled_date: null,
    starts_on: "2026-12-31",
    ends_on: "2027-01-05",
    title_uk: "Новий рік",
    description_uk: "Привітання",
    title_en: "New Year",
    description_en: "Greeting",
    title_ru: "Новый год",
    description_ru: "Поздравление",
    desktop_image_url: "/desktop.webp",
    tablet_image_url: "/tablet.webp",
    mobile_image_url: "/mobile.webp",
    desktop_storage_key: null,
    tablet_storage_key: null,
    mobile_storage_key: null,
    show_daily_fact_label: false,
    repeats_annually: false,
    is_active: true,
  };
  let updateValues = null;
  const db = {
    async query(sql, values) {
      if (sql.includes("WHERE id = $1") && !sql.includes("UPDATE")) return { rows: [current] };
      if (sql.includes("UPDATE homepage_banners")) {
        updateValues = values;
        return { rows: [{ ...current, scheduled_date: null, starts_on: null, ends_on: null }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await HomepageContentService.updateBanner(
    7,
    { startsOn: "", endsOn: "" },
    [],
    1,
    db,
  );

  assert.equal(updateValues[1], null);
  assert.equal(updateValues[2], null);
  assert.equal(updateValues[3], null);
  assert.equal(updateValues[4], false);
  assert.equal(result.startsOn, null);
  assert.equal(result.endsOn, null);
  assert.equal(result.showDailyFactLabel, false);
});

test("період без початку або зі зворотними датами відхиляється", async () => {
  await assert.rejects(
    HomepageContentService.createBanner({ startsOn: "", endsOn: "2026-12-31" }, [], 1),
    /Спочатку вкажіть дату початку/,
  );
  await assert.rejects(
    HomepageContentService.createBanner({ startsOn: "2027-01-05", endsOn: "2026-12-31" }, [], 1),
    /не може бути раніше/,
  );
});

test("активні періоди банерів не можуть перетинатися", async () => {
  const db = {
    async query() {
      return { rows: [{ id: 44 }] };
    },
  };
  await assert.rejects(
    HomepageContentService.createBanner({
      startsOn: "2026-12-31",
      endsOn: "2027-01-05",
      titleUk: "Новий рік",
      descriptionUk: "Привітання",
      titleEn: "New Year",
      descriptionEn: "Greeting",
      titleRu: "Новый год",
      descriptionRu: "Поздравление",
      isActive: true,
    }, [], 1, db),
    /перетинається/,
  );
});

test("активні щорічні періоди не можуть перетинатися", async () => {
  const db = {
    async query() {
      return { rows: [{ id: 45, starts_on: "2000-12-29", ends_on: "2000-01-05" }] };
    },
  };
  await assert.rejects(
    HomepageContentService.createBanner({
      repeatsAnnually: true,
      annualStartsOn: "02.01",
      annualEndsOn: "06.01",
      titleUk: "Новий рік",
      descriptionUk: "Привітання",
      titleEn: "New Year",
      descriptionEn: "Greeting",
      titleRu: "Новый год",
      descriptionRu: "Поздравление",
      isActive: true,
    }, [], 1, db),
    /щорічний період перетинається/,
  );
});
