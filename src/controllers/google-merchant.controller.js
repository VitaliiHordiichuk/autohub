import { GoogleMerchantFeedService } from "../services/GoogleMerchantFeedService.js";


export async function getGoogleMerchantFeed(_req, res) {
  try {
    const xml =
      await GoogleMerchantFeedService.generateXml();

    return res
      .status(200)
      .set("Content-Type", "application/rss+xml; charset=utf-8")
      .set("Cache-Control", "public, max-age=300")
      .send(xml);
  } catch (error) {
    console.error(
      "Google Merchant feed generation failed:",
      error
    );

    return res
      .status(500)
      .type("text/plain")
      .send("Google Merchant feed is temporarily unavailable");
  }
}
