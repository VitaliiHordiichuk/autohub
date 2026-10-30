import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


test(
  "production server listens only on the IPv4 loopback interface",
  async () => {
    const source =
      await readFile(
        new URL(
          "./server.js",
          import.meta.url
        ),
        "utf8"
      );

    assert.match(
      source,
      /app\.listen\(\s*PORT,\s*["']127\.0\.0\.1["'],/
    );
  }
);

test("preview server gates all background schedulers and bot startup", async () => {
  const source = await readFile(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /if \(areBackgroundJobsEnabled\(\)\) \{([\s\S]*?)\} else \{/);
  const gated = source.match(/if \(areBackgroundJobsEnabled\(\)\) \{([\s\S]*?)\} else \{/)[1];
  for (const starter of [
    "startEmailImportScheduler",
    "startAutomaticTranslationScheduler",
    "startTelegramBot",
    "startProductImageProcessingScheduler",
    "startDataRetentionScheduler",
  ]) {
    assert.match(gated, new RegExp(`${starter}\\(\\)`));
  }
});
