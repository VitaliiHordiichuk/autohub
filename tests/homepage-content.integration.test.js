import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { pool } from "../src/config/db.js";
import {
  HomepageContentService,
  homepageDateInKyiv,
} from "../src/services/HomepageContentService.js";

const scheduledDate = "2098-11-17";
const scheduledFrom = "2098-11-15";
const scheduledTo = "2098-11-19";
let bannerId;
let annualBannerId;
let featureId;
let adminUserId;
let article;

test("після опівночі головна використовує київську, а не UTC-дату", () => {
  assert.equal(homepageDateInKyiv(new Date("2026-08-15T21:30:00.000Z")), "2026-08-16");
});

test("київська дата враховує зимовий часовий пояс", () => {
  assert.equal(homepageDateInKyiv(new Date("2026-12-31T22:30:00.000Z")), "2027-01-01");
});

before(async () => {
  const [admin, product] = await Promise.all([
    pool.query(`
      SELECT u.id FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'ADMIN' AND u.is_active = TRUE
      ORDER BY u.id LIMIT 1`),
    pool.query(`
      SELECT p.article FROM products p
      WHERE p.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM product_offers po
          WHERE po.product_id = p.id
            AND po.is_available = TRUE
            AND po.is_hidden = FALSE
            AND po.quantity > 0
        )
      ORDER BY p.id LIMIT 1`),
  ]);
  assert.ok(admin.rows[0], "Адміністратор для тесту не знайдений");
  assert.ok(product.rows[0], "Товар із доступною пропозицією не знайдений");
  adminUserId = Number(admin.rows[0].id);
  article = product.rows[0].article;

  const banner = await pool.query(`
    INSERT INTO homepage_banners(
      starts_on, ends_on, title_uk, description_uk, title_en, description_en,
      title_ru, description_ru,
      desktop_image_url, tablet_image_url, mobile_image_url,
      is_active, show_daily_fact_label, created_by, updated_by
    ) VALUES($1,$2,'Тестовий факт','Опис тестового факту','Test fact','Test fact description',
      'Тестовый факт','Описание тестового факта',
      '/desktop.png','/tablet.png','/mobile.png',TRUE,FALSE,$3,$3)
    RETURNING id`, [scheduledFrom, scheduledTo, adminUserId]);
  bannerId = Number(banner.rows[0].id);

  const annualBanner = await pool.query(`
    INSERT INTO homepage_banners(
      starts_on, ends_on, repeats_annually,
      title_uk, description_uk, title_en, description_en,
      title_ru, description_ru,
      desktop_image_url, tablet_image_url, mobile_image_url,
      is_active, created_by, updated_by
    ) VALUES('2000-12-24','2000-12-26',TRUE,
      'Щорічне привітання','Щорічний опис','Annual greeting','Annual description',
      'Ежегодное поздравление','Ежегодное описание',
      '/annual-desktop.png','/annual-tablet.png','/annual-mobile.png',TRUE,$1,$1)
    RETURNING id`, [adminUserId]);
  annualBannerId = Number(annualBanner.rows[0].id);
});

after(async () => {
  if (featureId) await pool.query("DELETE FROM homepage_product_features WHERE id=$1", [featureId]);
  if (annualBannerId) await pool.query("DELETE FROM homepage_banners WHERE id=$1", [annualBannerId]);
  if (bannerId) await pool.query("DELETE FROM homepage_banners WHERE id=$1", [bannerId]);
  await pool.end();
});

test("банер з активним періодом має пріоритет над резервною базою", async () => {
  const homepage = await HomepageContentService.getPublic({
    locale: "uk",
    date: scheduledDate,
  });
  assert.equal(homepage.banner.id, bannerId);
  assert.equal(homepage.banner.title, "Тестовий факт");
  assert.equal(homepage.banner.showDailyFactLabel, false);
  assert.deepEqual(homepage.banner.images, {
    desktop: "/desktop.png",
    tablet: "/tablet.png",
    mobile: "/mobile.png",
  });
});

test("банер поза своїм періодом не потрапляє до резервної ротації", async () => {
  const homepage = await HomepageContentService.getPublic({
    locale: "uk",
    date: "2098-11-20",
  });
  assert.notEqual(homepage.banner?.id, bannerId);
});

test("щорічний банер показується у той самий день наступного року", async () => {
  const homepage = await HomepageContentService.getPublic({
    locale: "uk",
    date: "2099-12-25",
  });
  assert.equal(homepage.banner.id, annualBannerId);
  assert.equal(homepage.banner.repeatsAnnually, true);
  assert.equal(homepage.banner.annualStartsOn, "24.12");
  assert.equal(homepage.banner.annualEndsOn, "26.12");
});

test("російська локаль повертає російський публічний вміст", async () => {
  const homepage = await HomepageContentService.getPublic({
    locale: "ru",
    date: scheduledDate,
  });
  assert.equal(homepage.locale, "ru");
  assert.equal(homepage.banner.title, "Тестовый факт");
});

test("акція створюється за артикулом і повертає актуальну клієнтську ціну", async () => {
  const feature = await HomepageContentService.createFeature({
    featureType: "PROMOTION",
    article,
    startsOn: "2098-01-01",
    endsOn: "2098-12-31",
    sortOrder: 1,
    isActive: true,
  }, adminUserId);
  featureId = feature.id;

  const homepage = await HomepageContentService.getPublic({
    locale: "uk",
    date: scheduledDate,
  });
  const publicFeature = homepage.features.find((item) => item.id === featureId);
  assert.ok(publicFeature);
  assert.equal(publicFeature.product.article, article);
  assert.equal(publicFeature.discountPercent, null);
  assert.ok(Number(publicFeature.offer?.price) > 0);
});
