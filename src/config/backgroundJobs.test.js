import assert from "node:assert/strict";
import test from "node:test";

import { areBackgroundJobsEnabled } from "./backgroundJobs.js";

test("background jobs retain the current default in production", () => {
  assert.equal(areBackgroundJobsEnabled({}), true);
  assert.equal(areBackgroundJobsEnabled({ BACKGROUND_JOBS_ENABLED: "true" }), true);
});

test("preview instance can disable every background job", () => {
  for (const value of ["false", "0", "no", "off", " FALSE "]) {
    assert.equal(areBackgroundJobsEnabled({ BACKGROUND_JOBS_ENABLED: value }), false);
  }
});
