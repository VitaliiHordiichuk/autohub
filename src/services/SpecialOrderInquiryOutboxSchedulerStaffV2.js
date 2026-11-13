/**
 * MAKA TXT inquiry outbox worker. Explicit opt-in and existing background job gate.
 * Never polls Telegram or accesses a database unless enabled and started.
 */
import { areBackgroundJobsEnabled } from '../config/backgroundJobs.js';
import {
  expandOneSpecialOrderInquiryNotification,
  claimSpecialOrderInquiryDelivery,
  loadSpecialOrderInquiryDelivery,
  finishSpecialOrderInquiryDelivery,
} from '../repositories/SpecialOrderInquiryOutboxRepositoryStaffV2.js';
import {
  buildSpecialOrderStaffMessage,
  sendSpecialOrderInquiryTelegram,
} from './SpecialOrderInquiryNotificationService.js';

export function isSpecialOrderInquiryOutboxWorkerEnabled(env = process.env) {
  return env.MAKA_SPECIAL_ORDER_OUTBOX_WORKER_ENABLED === 'true' &&
    env.MAKA_TXT_INQUIRIES_ENABLED === 'true' &&
    typeof env.TELEGRAM_BOT_TOKEN === 'string' &&
    env.TELEGRAM_BOT_TOKEN.trim().length > 0 &&
    areBackgroundJobsEnabled(env);
}

export async function processOneSpecialOrderInquiryDelivery({
  claim = claimSpecialOrderInquiryDelivery,
  load = loadSpecialOrderInquiryDelivery,
  finish = finishSpecialOrderInquiryDelivery,
  transport = sendSpecialOrderInquiryTelegram,
} = {}) {
  const delivery = await claim();
  if (!delivery) return 'EMPTY';
  try {
    const data = await load(delivery);
    if (!data?.stillAuthorized) {
      await finish(delivery, 'SKIPPED');
      return 'SKIPPED';
    }
    const message = buildSpecialOrderStaffMessage(data.event);
    await transport(delivery.telegram_chat_id, message);
    await finish(delivery, 'SENT');
    return 'SENT';
  } catch (error) {
    // Failing to record the retry leaves the claim leased; it will expire.
    try { await finish(delivery, 'RETRY'); }
    catch { console.error('Special-order outbox cannot record failed attempt'); }
    // Do not log response bodies, phone numbers, tokens or chat IDs.
    console.error('Special-order outbox send attempt failed');
    return 'RETRY';
  }
}

export async function runSpecialOrderInquiryOutboxBatch({
  expand = expandOneSpecialOrderInquiryNotification,
  process = processOneSpecialOrderInquiryDelivery,
} = {}) {
  // Bound database + Telegram work per pass; never run an unbounded drain.
  for (let i = 0; i < 5; i++) {
    const result = await expand();
    if (result.kind === 'EMPTY') break;
  }
  for (let i = 0; i < 10; i++) {
    if (await process() === 'EMPTY') break;
  }
}

let started = false;
export function startSpecialOrderInquiryOutboxScheduler(env = process.env) {
  if (!isSpecialOrderInquiryOutboxWorkerEnabled(env) || started) return false;
  started = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runSpecialOrderInquiryOutboxBatch(); }
    catch { console.error('Special-order outbox background job failed'); }
    finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 15_000);
  timer.unref?.();
  void tick();
  return true;
}
