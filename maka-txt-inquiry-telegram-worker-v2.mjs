import { readFileSync, lstatSync } from "node:fs";

const tokenFile =
  "/home/ubuntu/maka-bot-identity-preview-20261105/.env";

const stat = lstatSync(tokenFile);

if (
  !stat.isFile() ||
  stat.isSymbolicLink() ||
  stat.uid !== process.getuid() ||
  (stat.mode & 0o022) !== 0
) {
  throw new Error("UNSAFE_TELEGRAM_CONFIG");
}

const content = readFileSync(tokenFile, "utf8");

const matches = [
  ...content.matchAll(
    /^\s*(?:export\s+)?TELEGRAM_BOT_TOKEN\s*=\s*(.+)\s*$/gm
  )
];

if (matches.length !== 1) {
  throw new Error("TELEGRAM_TOKEN_CONFIG_MISSING");
}

let token = matches[0][1].trim();

if (
  (token.startsWith('"') && token.endsWith('"')) ||
  (token.startsWith("'") && token.endsWith("'"))
) {
  token = token.slice(1, -1);
}

if (!/^\d+:[A-Za-z0-9_-]{25,}$/.test(token)) {
  throw new Error("INVALID_TELEGRAM_TOKEN_FORMAT");
}

process.env.TELEGRAM_BOT_TOKEN = token;

const {
  isSpecialOrderInquiryOutboxWorkerEnabled,
  startSpecialOrderInquiryOutboxScheduler
} = await import(
  "./src/services/SpecialOrderInquiryOutboxSchedulerStaffV2.js"
);

if (!isSpecialOrderInquiryOutboxWorkerEnabled()) {
  throw new Error("OUTBOX_WORKER_GATE_DISABLED");
}

if (!startSpecialOrderInquiryOutboxScheduler()) {
  throw new Error("OUTBOX_WORKER_NOT_STARTED");
}

console.log("MAKA TXT Telegram worker started");

// Scheduler uses unref() internally.
// Keep this dedicated worker process alive.
setInterval(() => {}, 60_000);
