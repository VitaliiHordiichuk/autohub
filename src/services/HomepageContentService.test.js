import test from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";

import {
  HomepageContentService,
  annualDateIsWithin,
  homepageDateInKyiv,
  selectHomepageBanner,
} from "./HomepageContentService.js";

test("доба банера змінюється за Києвом, а не за UTC сервера", () => {
  assert.equal(homepageDateInKyiv("2026-11-02T21:59:59Z"), "2026-11-02");
  assert.equal(homepageDateInKyiv("2026-11-02T22:00:00Z"), "2026-11-03");
  assert.equal(homepageDateInKyiv("2026-07-01T20:59:59Z"), "2026-07-01");
  assert.equal(homepageDateInKyiv("2026-07-01T21:00:00Z"), "2026-07-02");
});

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
  assert.equal(queryCount, 4);
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
  assert.equal(queryCount, 6);
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
    daily_selection_type: "ROTATION",
    id: 19,
    title_uk: "Зафіксований факт дня",
    is_active: true,
    starts_on: null,
    ends_on: null,
    repeats_annually: false,
  };
  let writes = 0;
  const db = {
    async query(sql, values) {
      if (sql.includes("FROM homepage_banner_daily_selections selection")) {
        assert.deepEqual(values, ["2026-09-16"]);
        return { rows: [stored] };
      }
      if (sql.includes("FROM homepage_banners")) return { rows: [] };
      writes += 1;
      throw new Error(`Unexpected write: ${sql}`);
    },
  };

  assert.equal(await selectHomepageBanner("2026-09-16", db), stored);
  assert.equal(await selectHomepageBanner("2026-09-16", db), stored);
  assert.equal(writes, 0);
});

test("одночасні запити використовують перший зафіксований банер", async () => {
  const candidate = { id: 2 };
  const concurrent = {
    daily_banner_id: 9, daily_selection_type: "ROTATION", id: 9,
    is_active: true, starts_on: null, ends_on: null, repeats_annually: false,
  };
  let dailyReads = 0;
  const db = {
    async query(sql) {
      if (sql.includes("FROM homepage_banner_daily_selections selection")) {
        dailyReads += 1;
        return { rows: dailyReads < 3 ? [] : [concurrent] };
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
  assert.equal(dailyReads, 3);
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
  const db = {
    async query(sql) {
      if (sql.includes("FROM homepage_banner_daily_selections selection")) return { rows: [] };
      if (sql.includes("INSERT INTO homepage_banner_daily_selections")) {
        return { rows: [{ banner_id: annual.id }] };
      }
      if (sql.includes("repeats_annually = TRUE")) return { rows: [annual] };
      return { rows: [] };
    },
  };

  assert.equal(await selectHomepageBanner("2032-08-25", db), annual);
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
      if (sql.includes("SELECT display_date, banner_id, selection_type")) return { rows: [] };
      if (sql.includes("DELETE FROM homepage_banner_daily_selections")) return { rows: [] };
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

function memoryBannerDb(initialBanners = [], initialSelections = []) {
  const banners = new Map(initialBanners.map((banner) => [Number(banner.id), { ...banner }]));
  const selections = new Map(initialSelections.map((selection) => [selection.display_date, { ...selection }]));
  const writes = [];
  return {
    banners,
    selections,
    writes,
    async query(sql, values = []) {
      if (sql.includes("SELECT display_date, banner_id, selection_type")) {
        return { rows: [...selections.values()]
          .filter((selection) => selection.display_date >= values[0])
          .map((selection) => ({ ...selection })) };
      }
      if (sql.includes("FROM homepage_banner_daily_selections selection")) {
        const selection = selections.get(values[0]);
        if (!selection) return { rows: [] };
        const banner = banners.get(Number(selection.banner_id));
        return { rows: [{
          daily_banner_id: selection.banner_id,
          daily_selection_type: selection.selection_type,
          ...banner,
        }] };
      }
      if (sql.includes("SELECT * FROM homepage_banners WHERE id = $1")) {
        const banner = banners.get(Number(values[0]));
        return { rows: banner ? [{ ...banner }] : [] };
      }
      if (sql.includes("SELECT id, starts_on, ends_on FROM homepage_banners")
        || sql.includes("SELECT id FROM homepage_banners")) return { rows: [] };
      if (sql.includes("COALESCE(repeats_annually, FALSE) = FALSE")
        && sql.includes("starts_on <= $1::date")) {
        const date = values[0];
        const matches = [...banners.values()].filter((banner) => banner.is_active
          && !banner.repeats_annually && banner.starts_on && banner.ends_on
          && banner.starts_on <= date && banner.ends_on >= date);
        matches.sort((a, b) => b.starts_on.localeCompare(a.starts_on)
          || a.ends_on.localeCompare(b.ends_on) || b.id - a.id);
        return { rows: matches.slice(0, 1).map((banner) => ({ ...banner })) };
      }
      if (sql.includes("AND repeats_annually = TRUE")) {
        return { rows: [...banners.values()]
          .filter((banner) => banner.is_active && banner.repeats_annually)
          .sort((a, b) => b.id - a.id)
          .map((banner) => ({ ...banner })) };
      }
      if (sql.includes("WITH last_rotation")) {
        const previous = [...selections.values()]
          .filter((selection) => selection.display_date < values[0]
            && selection.selection_type === "ROTATION" && selection.rotation_position !== null)
          .sort((a, b) => b.display_date.localeCompare(a.display_date))[0];
        const lastId = Number(previous?.rotation_position || 0);
        const candidates = [...banners.values()]
          .filter((banner) => banner.is_active && !banner.repeats_annually
            && !banner.starts_on && !banner.ends_on)
          .sort((a, b) => Number(b.id > lastId) - Number(a.id > lastId) || a.id - b.id);
        return { rows: candidates.slice(0, 1).map((banner) => ({ ...banner })) };
      }
      if (sql.includes("DELETE FROM homepage_banner_daily_selections")) {
        writes.push("DELETE_SELECTION");
        if (sql.includes("= ANY($1::date[])")) {
          for (const date of values[0]) selections.delete(date);
          return { rows: [] };
        }
        for (const [date, selection] of selections) {
          if (sql.includes("banner_id IS NOT DISTINCT FROM")) {
            if (date === values[0] && selection.banner_id === values[1]
              && selection.selection_type === values[2]) selections.delete(date);
          } else if (date >= values[0]
            && (!sql.includes("banner_id = $2") || selection.banner_id === values[1])
            && (!sql.includes("selection_type = 'EMPTY'") || selection.selection_type === "EMPTY")) {
            selections.delete(date);
          }
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO homepage_banner_daily_selections")) {
        writes.push("INSERT_SELECTION");
        if (selections.has(values[0])) return { rows: [] };
        selections.set(values[0], {
          display_date: values[0], banner_id: values[1],
          selection_type: values[2], rotation_position: values[3],
        });
        return { rows: [{ banner_id: values[1] }] };
      }
      if (sql.includes("INSERT INTO homepage_banners")) {
        writes.push("INSERT_BANNER");
        const id = Math.max(0, ...banners.keys()) + 1;
        const banner = {
          id, scheduled_date: values[0], starts_on: values[1], ends_on: values[2],
          repeats_annually: values[3], title_uk: values[4], description_uk: values[5],
          title_en: values[6], description_en: values[7], title_ru: values[8],
          description_ru: values[9], desktop_image_url: values[10],
          tablet_image_url: values[11], mobile_image_url: values[12],
          desktop_storage_key: values[13], tablet_storage_key: values[14],
          mobile_storage_key: values[15], is_active: values[16],
          show_daily_fact_label: values[17],
        };
        banners.set(id, banner);
        return { rows: [{ ...banner }] };
      }
      if (sql.includes("UPDATE homepage_banners SET")) {
        writes.push("UPDATE_BANNER");
        const banner = banners.get(Number(values[0]));
        Object.assign(banner, {
          scheduled_date: values[1], starts_on: values[2], ends_on: values[3],
          repeats_annually: values[4], title_uk: values[5], description_uk: values[6],
          title_en: values[7], description_en: values[8], title_ru: values[9],
          description_ru: values[10], desktop_image_url: values[11],
          tablet_image_url: values[12], mobile_image_url: values[13],
          desktop_storage_key: values[14], tablet_storage_key: values[15],
          mobile_storage_key: values[16], is_active: values[17],
          show_daily_fact_label: values[18],
        });
        return { rows: [{ ...banner }] };
      }
      if (sql.includes("DELETE FROM homepage_banners")) {
        writes.push("DELETE_BANNER");
        const banner = banners.get(Number(values[0]));
        if (!banner) return { rows: [] };
        banners.delete(Number(values[0]));
        for (const selection of selections.values()) {
          if (selection.banner_id === Number(values[0])) selection.banner_id = null;
        }
        return { rows: [{ ...banner }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

function rotatingBanner(id) {
  return {
    id, is_active: true, repeats_annually: false, starts_on: null, ends_on: null,
    title_uk: `Банер ${id}`, description_uk: `Опис ${id}`,
    title_en: `Banner ${id}`, description_en: `Description ${id}`,
    title_ru: `Баннер ${id}`, description_ru: `Описание ${id}`,
    desktop_image_url: "/desktop.png", tablet_image_url: "/tablet.png",
    mobile_image_url: "/mobile.png", show_daily_fact_label: true,
  };
}

function scheduledBanner(id, startsOn, endsOn = startsOn) {
  return { ...rotatingBanner(id), starts_on: startsOn, ends_on: endsOn };
}

test("видалення вибраного банера одразу відновлює ротацію", async () => {
  const today = homepageDateInKyiv();
  const db = memoryBannerDb([rotatingBanner(1), rotatingBanner(2)], [{
    display_date: today, banner_id: 1, selection_type: "ROTATION", rotation_position: 1,
  }]);

  await HomepageContentService.deleteBanner(1, db);
  assert.equal(db.selections.has(today), false);
  assert.equal((await selectHomepageBanner(today, db)).id, 2);
  assert.equal(db.selections.get(today).rotation_position, 2);
});

test("стара добова бронь з NULL після видалення не блокує вибір", async () => {
  const today = homepageDateInKyiv();
  const db = memoryBannerDb([rotatingBanner(8)], [{
    display_date: today, banner_id: null, selection_type: "ROTATION", rotation_position: 7,
  }]);

  assert.equal((await selectHomepageBanner(today, db)).id, 8);
  assert.equal(db.selections.get(today).banner_id, 8);
  assert.ok(db.writes.includes("DELETE_SELECTION"));
});

test("точна дата переважає щорічний банер і попередню ротацію", async () => {
  const today = homepageDateInKyiv();
  const monthDay = `2000-${today.slice(5)}`;
  const db = memoryBannerDb([
    rotatingBanner(1),
    { ...scheduledBanner(2, monthDay), repeats_annually: true },
    scheduledBanner(3, today),
  ], [{ display_date: today, banner_id: 1, selection_type: "ROTATION", rotation_position: 1 }]);

  assert.equal((await selectHomepageBanner(today, db)).id, 3);
  assert.equal(db.selections.get(today).selection_type, "SCHEDULED");
  await HomepageContentService.deleteBanner(3, db);
  assert.equal((await selectHomepageBanner(today, db)).id, 2);
});

test("перенесення дати банера на сьогодні відразу оновлює вибір", async () => {
  const today = homepageDateInKyiv();
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const db = memoryBannerDb([
    rotatingBanner(1), scheduledBanner(2, tomorrow.toISOString().slice(0, 10)),
  ], [{ display_date: today, banner_id: 1, selection_type: "ROTATION", rotation_position: 1 }]);

  await HomepageContentService.updateBanner(2, { scheduledDate: today }, [], 1, db);
  assert.equal((await selectHomepageBanner(today, db)).id, 2);
});

test("зміна майбутнього розкладу не скидає сьогоднішню ротацію", async () => {
  const today = homepageDateInKyiv();
  const later = new Date(`${today}T12:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 2);
  const oldDate = later.toISOString().slice(0, 10);
  later.setUTCDate(later.getUTCDate() + 1);
  const newDate = later.toISOString().slice(0, 10);
  const db = memoryBannerDb([
    rotatingBanner(1), scheduledBanner(2, oldDate),
  ], [
    { display_date: today, banner_id: 1, selection_type: "ROTATION", rotation_position: 1 },
    { display_date: oldDate, banner_id: 2, selection_type: "SCHEDULED", rotation_position: null },
  ]);

  await HomepageContentService.updateBanner(2, { scheduledDate: newDate }, [], 1, db);
  assert.equal(db.selections.get(today).banner_id, 1);
  assert.equal(db.selections.has(oldDate), false);
});

test("відключення сьогоднішнього банера повертає резервний", async () => {
  const today = homepageDateInKyiv();
  const db = memoryBannerDb([
    rotatingBanner(1), scheduledBanner(2, today),
  ], [{ display_date: today, banner_id: 2, selection_type: "SCHEDULED", rotation_position: null }]);

  await HomepageContentService.updateBanner(2, { isActive: false }, [], 1, db);
  assert.equal((await selectHomepageBanner(today, db)).id, 1);
});

test("відсутність банерів фіксує EMPTY, але старий EMPTY не ховає новий банер", async () => {
  const today = homepageDateInKyiv();
  const db = memoryBannerDb();
  assert.equal(await selectHomepageBanner(today, db), null);
  assert.equal(await selectHomepageBanner(today, db), null);
  assert.equal(db.selections.get(today).selection_type, "EMPTY");
  assert.equal(db.writes.filter((write) => write === "INSERT_SELECTION").length, 1);

  db.banners.set(1, rotatingBanner(1));
  assert.equal((await selectHomepageBanner(today, db)).id, 1);
});

test("новий день продовжує ротацію, а запланований банер її не пересуває", async () => {
  const db = memoryBannerDb([
    rotatingBanner(1), rotatingBanner(3), scheduledBanner(9, "2098-11-16"),
  ]);
  assert.equal((await selectHomepageBanner("2098-11-15", db)).id, 1);
  assert.equal((await selectHomepageBanner("2098-11-16", db)).id, 9);
  assert.equal((await selectHomepageBanner("2098-11-17", db)).id, 3);
  assert.equal((await selectHomepageBanner("2098-11-17", db)).id, 3);
  assert.equal(db.writes.filter((write) => write === "INSERT_SELECTION").length, 3);
});

test("створений удень банер на сьогодні замінює ранкову ротацію", async (t) => {
  const today = homepageDateInKyiv();
  const db = memoryBannerDb([rotatingBanner(1)], [{
    display_date: today, banner_id: 1, selection_type: "ROTATION", rotation_position: 1,
  }]);
  const variables = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"];
  const previous = Object.fromEntries(variables.map((key) => [key, process.env[key]]));
  for (const key of variables) process.env[key] = `test-${key}`;
  t.mock.method(S3Client.prototype, "send", async () => ({}));
  try {
    const files = ["desktop", "tablet", "mobile"].map((slot) => ({
      fieldname: `${slot}Image`, mimetype: "image/png", buffer: Buffer.from("test"),
    }));
    const created = await HomepageContentService.createBanner({
      scheduledDate: today,
      titleUk: "Факт", descriptionUk: "Опис",
      titleEn: "Fact", descriptionEn: "Description",
      titleRu: "Факт", descriptionRu: "Описание",
      isActive: true,
    }, files, 1, db);
    assert.equal(created.id, 2);
    assert.equal((await selectHomepageBanner(today, db)).id, 2);
  } finally {
    for (const key of variables) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
