import test from "node:test";
import assert from "node:assert/strict";
import { selectHomepageBanner } from "./HomepageContentService.js";

function fakeDatabase({
  scheduled = null,
  rotating = null,
  selection = null,
} = {}) {
  let stored = selection;
  let queue = Promise.resolve();

  const counters = {
    locks: 0,
    inserts: 0,
    deletes: 0,
  };

  async function query(sql, params = [], tx = null) {
    const q = String(sql).trim();

    if (q === "BEGIN") return { rows: [] };

    if (q === "COMMIT" || q === "ROLLBACK") {
      if (tx?.unlock) {
        tx.unlock();
        tx.unlock = null;
      }
      return { rows: [] };
    }

    if (q.includes("pg_advisory_xact_lock")) {
      counters.locks++;

      const previous = queue;
      let release;

      queue = new Promise((resolve) => {
        release = resolve;
      });

      await previous;
      tx.unlock = release;
      return { rows: [] };
    }

    if (q.includes("FROM homepage_banner_daily_selections selection")) {
      if (!stored) return { rows: [] };

      return {
        rows: [{
          daily_banner_id: stored.banner?.id ?? null,
          daily_selection_type: stored.type,
          ...(stored.banner || {}),
        }],
      };
    }

    if (q.includes("FROM homepage_banners") &&
        q.includes("starts_on <= $1::date")) {
      return { rows: scheduled ? [scheduled] : [] };
    }

    if (q.includes("FROM homepage_banners") &&
        q.includes("repeats_annually = TRUE")) {
      return { rows: [] };
    }

    if (q.includes("WITH last_rotation")) {
      return { rows: rotating ? [rotating] : [] };
    }

    if (q.includes("DELETE FROM homepage_banner_daily_selections")) {
      counters.deletes++;
      stored = null;
      return { rows: [] };
    }

    if (q.includes("INSERT INTO homepage_banner_daily_selections")) {
      counters.inserts++;

      if (stored) return { rows: [] };

      const bannerId = params[1];
      const banner = scheduled?.id === bannerId
        ? scheduled
        : rotating?.id === bannerId
          ? rotating
          : null;

      stored = {
        banner,
        type: params[2],
      };

      return {
        rows: [{ banner_id: bannerId }],
      };
    }

    throw new Error(`Unexpected SQL: ${q}`);
  }

  const db = {
    query: (sql, args) => query(sql, args),
    async connect() {
      const tx = {};

      return {
        query: (sql, args) => query(sql, args, tx),
        release() {
          assert.equal(tx.unlock ?? null, null);
        },
      };
    },
  };

  return { db, counters };
}

test("two simultaneous requests select one daily banner", async () => {
  const rotating = {
    id: 5,
    is_active: true,
    starts_on: null,
    ends_on: null,
    repeats_annually: false,
  };

  const { db, counters } = fakeDatabase({ rotating });

  const results = await Promise.all([
    selectHomepageBanner("2098-01-01", db),
    selectHomepageBanner("2098-01-01", db),
  ]);

  assert.deepEqual(results.map(x => x?.id), [5, 5]);
  assert.equal(counters.inserts, 1);
  assert.ok(counters.locks >= 1);
});

test("new scheduled banner replaces stale rotation", async () => {
  const scheduled = {
    id: 40,
    is_active: true,
    starts_on: "2098-01-02",
    ends_on: "2098-01-02",
    repeats_annually: false,
  };

  const oldBanner = {
    id: 3,
    is_active: true,
    starts_on: null,
    ends_on: null,
    repeats_annually: false,
  };

  const { db, counters } = fakeDatabase({
    scheduled,
    selection: {
      type: "ROTATION",
      banner: oldBanner,
    },
  });

  const result = await selectHomepageBanner("2098-01-02", db);

  assert.equal(result.id, 40);
  assert.equal(counters.deletes, 1);
  assert.equal(counters.inserts, 1);
  assert.equal(counters.locks, 1);
});

test("empty daily selection can become a rotation", async () => {
  const rotating = {
    id: 7,
    is_active: true,
    starts_on: null,
    ends_on: null,
    repeats_annually: false,
  };

  const { db, counters } = fakeDatabase({
    rotating,
    selection: {
      type: "EMPTY",
      banner: null,
    },
  });

  const result = await selectHomepageBanner("2098-01-03", db);

  assert.equal(result.id, 7);
  assert.equal(counters.deletes, 1);
  assert.equal(counters.inserts, 1);
});
