import { TelegramConnectionService } from "../services/TelegramConnectionService.js";

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
