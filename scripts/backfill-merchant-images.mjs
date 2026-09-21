import { pool } from "../src/config/db.js";
import {
  MERCHANT_IMAGE_BACKFILL_DEFAULT_LIMIT,
  MERCHANT_IMAGE_BACKFILL_MAX_LIMIT,
  MerchantImageBackfillService,
} from "../src/services/MerchantImageBackfillService.js";

function readOptionValue(argumentsList, index, name) {
  const argument = argumentsList[index];
  const prefix = `--${name}=`;
  if (argument.startsWith(prefix)) {
    return { value: argument.slice(prefix.length), consumed: 0 };
  }
  if (argument === `--${name}` && argumentsList[index + 1] !== undefined) {
    return { value: argumentsList[index + 1], consumed: 1 };
  }
  return null;
}

export function parseMerchantImageBackfillArguments(argumentsList) {
  const options = {
    limit: MERCHANT_IMAGE_BACKFILL_DEFAULT_LIMIT,
    cursor: 0,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const limit = readOptionValue(argumentsList, index, "limit");
    if (limit) {
      options.limit = limit.value;
      index += limit.consumed;
      continue;
    }
    const cursor = readOptionValue(argumentsList, index, "cursor");
    if (cursor) {
      options.cursor = cursor.value;
      index += cursor.consumed;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Controlled Google Merchant image backfill

Usage:
  npm run backfill:merchant-images -- --dry-run --limit=50 --cursor=0
  npm run backfill:merchant-images -- --limit=50 --cursor=0

Options:
  --dry-run       List work without reading R2, uploading or writing to the database
  --limit=N       Batch size, 1-${MERCHANT_IMAGE_BACKFILL_MAX_LIMIT} (default ${MERCHANT_IMAGE_BACKFILL_DEFAULT_LIMIT})
  --cursor=ID     Process missing Merchant images with image id greater than ID
  --help, -h      Show this help`);
}

function printSummary(summary) {
  console.log(`Mode: ${summary.dryRun ? "DRY RUN" : "EXECUTE"}`);
  console.log(`Candidates after cursor ${summary.cursor}: ${summary.totalCandidates}`);
  for (const detail of summary.details) {
    const reason = detail.reason ? ` reason=${detail.reason}` : "";
    const error = detail.error ? ` error=${JSON.stringify(detail.error)}` : "";
    console.log(`[${detail.status}] image=${detail.imageId} product=${detail.productId}${reason}${error}`);
  }
  console.log(JSON.stringify({
    scanned: summary.scanned,
    eligible: summary.eligible,
    processed: summary.processed,
    skipped: summary.skipped,
    failed: summary.failed,
    reasons: summary.reasons,
    nextCursor: summary.nextCursor,
    hasMore: summary.hasMore,
  }, null, 2));
}

async function main() {
  const options = parseMerchantImageBackfillArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const summary = await MerchantImageBackfillService.run(options, { db: pool });
  printSummary(summary);
  if (summary.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`Merchant image backfill failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
