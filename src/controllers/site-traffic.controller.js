import { SiteTrafficService } from "../services/SiteTrafficService.js";

export async function recordSitePageView(req, res) {
  res.set("Cache-Control", "no-store");
  try {
    const recorded = await SiteTrafficService.record(req, req.body);
    return res.status(202).json({ success: true, recorded });
  } catch (error) {
    if (!error.statusCode) console.error("Site traffic recording failed:", error.code || "DATABASE_ERROR");
    return res.status(error.statusCode || 503).json({ success: false, error: "Не вдалося записати відвідування" });
  }
}

export async function getSiteTraffic(req, res) {
  res.set("Cache-Control", "private, no-store");
  try { return res.json({ success: true, ...await SiteTrafficService.dashboard(req.query) }); }
  catch (error) {
    if (!error.statusCode) console.error("Site traffic dashboard failed:", error.code || "DATABASE_ERROR");
    return res.status(error.statusCode || 500).json({ success: false,
      error: error.statusCode ? error.message : "Не вдалося завантажити відвідуваність" });
  }
}

export async function getSiteVisitEvents(req, res) {
  res.set("Cache-Control", "private, no-store");
  try { return res.json({ success: true, ...await SiteTrafficService.visitEvents(req.params.visitKey, req.query) }); }
  catch (error) {
    if (!error.statusCode) console.error("Site visit journal failed:", error.code || "DATABASE_ERROR");
    return res.status(error.statusCode || 500).json({success:false,
      error:error.statusCode ? error.message : "Не вдалося завантажити історію відвідування"});
  }
}
