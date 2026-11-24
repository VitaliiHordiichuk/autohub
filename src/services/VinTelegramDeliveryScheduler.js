import { areBackgroundJobsEnabled } from '../config/backgroundJobs.js';
import {
  claimVinTelegramDelivery, loadVinTelegramDelivery, finishVinTelegramDelivery,
} from '../repositories/VinTelegramDeliveryRepository.js';
import { buildVinStaffNotification } from './TelegramNotificationService.js';
import { sendSpecialOrderInquiryTelegram } from './SpecialOrderInquiryNotificationService.js';

export function isVinTelegramDeliveryEnabled(env = process.env) {
  return env.MAKA_VIN_TELEGRAM_ENABLED === 'true'
    && env.NODE_ENV !== 'test'
    && typeof env.TELEGRAM_BOT_TOKEN === 'string'
    && env.TELEGRAM_BOT_TOKEN.trim().length > 0
    && areBackgroundJobsEnabled(env);
}

export async function processOneVinTelegramDelivery({
  claim = claimVinTelegramDelivery, load = loadVinTelegramDelivery,
  finish = finishVinTelegramDelivery, transport = sendSpecialOrderInquiryTelegram,
  frontendUrl = process.env.FRONTEND_PUBLIC_URL || 'https://maka.com.ua',
  logger = console,
} = {}) {
  const delivery = await claim();
  if (!delivery) return 'EMPTY';
  if (delivery.status === 'FAILED') return 'FAILED';
  let activeDelivery = delivery;
  try {
    const data = await load(delivery);
    if (!data) return 'CLAIM_LOST';
    if (data.stillAuthorized !== true) {
      await finish(delivery, 'SKIPPED');
      return 'SKIPPED';
    }
    activeDelivery = { ...delivery, chatId: data.chatId };
    const message = buildVinStaffNotification({
      request: data.request, event: data.event, message: data.message,
      locale: data.locale, frontendUrl,
    });
    await transport(data.chatId, { parse_mode: 'HTML', ...message });
    await finish(activeDelivery, 'SENT');
    return 'SENT';
  } catch {
    // No request/phone/chat/token or Telegram response bodies in logs or payload.
    try { await finish(activeDelivery, 'RETRY'); }
    catch { logger.error('VIN Telegram delivery retry state unavailable'); }
    logger.error('VIN Telegram delivery attempt failed');
    return 'RETRY';
  }
}

export async function runVinTelegramDeliveryBatch({ process = processOneVinTelegramDelivery } = {}) {
  for (let count = 0; count < 10; count++) {
    if (await process() === 'EMPTY') break;
  }
}

let started = false;
export function startVinTelegramDeliveryScheduler(env = process.env, {
  run = runVinTelegramDeliveryBatch, schedule = setInterval, logger = console,
} = {}) {
  if (!isVinTelegramDeliveryEnabled(env) || started) return false;
  started = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await run(); }
    catch { logger.error('VIN Telegram delivery background job failed'); }
    finally { busy = false; }
  };
  const timer = schedule(() => { void tick(); }, 15_000);
  timer.unref?.();
  void tick();
  return true;
}
