import { SiteContactService } from "../services/SiteContactService.js";

function fail(res, error) {
  console.error("Site contact settings error:", error);
  return res.status(error?.statusCode || 500).json({
    success: false,
    code: error?.code || "SITE_CONTACT_ERROR",
    error: error instanceof Error
      ? error.message
      : "Не вдалося зберегти контакт",
  });
}

export async function getPublicSiteContact(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      contact: await SiteContactService.getPublic(),
    });
  } catch (error) {
    return fail(res, error);
  }
}

export async function getAdminSiteContact(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      contact: await SiteContactService.getAdmin(),
    });
  } catch (error) {
    return fail(res, error);
  }
}

export async function updateAdminSiteContact(req, res) {
  try {
    const contact = await SiteContactService.update({
      phone: req.body?.phone,
      changedBy: req.auth.userId,
    });
    return res.json({ success: true, contact });
  } catch (error) {
    return fail(res, error);
  }
}
