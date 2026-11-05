import { TelegramConnectionService } from "../services/TelegramConnectionService.js";
import { claimTelegramRegistrationForExistingClient } from "../services/TelegramIdentityLinkService.js";

function fail(res, error) {
  const status = error.code === "TELEGRAM_NOT_CONFIGURED" ? 503 : 400;
  return res.status(status).json({ success: false, code: error.code, error: error.message });
}

export async function getTelegramStatus(req, res) {
  try { return res.json({ success: true, telegram: await TelegramConnectionService.status(req.auth.userId) }); }
  catch (error) { return fail(res, error); }
}

export async function createTelegramLink(req, res) {
  try { return res.json({ success: true, ...(await TelegramConnectionService.createLink(req.auth.userId, req.body?.locale)) }); }
  catch (error) { return fail(res, error); }
}

export async function disconnectTelegram(req, res) {
  try { await TelegramConnectionService.disconnect(req.auth.userId); return res.json({ success: true }); }
  catch (error) { return fail(res, error); }
}

// A bot-issued, short-lived proof can also link an existing logged-in customer.
export async function claimTelegramFromBot(req, res) {
  try {
    await claimTelegramRegistrationForExistingClient({
      token: req.body?.telegramRegistrationToken,
      userId: req.auth.userId,
    });
    return res.json({ success: true, connected: true });
  } catch (error) {
    return res.status(Number(error.statusCode) || 400).json({
      success: false,
      ...(error.apiCode ? { code: error.apiCode } : {}),
      error: error.message,
    });
  }
}
