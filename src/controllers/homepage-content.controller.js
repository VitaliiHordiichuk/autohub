import { HomepageContentService } from "../services/HomepageContentService.js";

function fail(res, error) {
  console.error("Помилка вмісту головної сторінки:", error);
  if (error?.code === "23505") {
    return res.status(409).json({
      success: false,
      error: "На цю дату вже призначено інший банер",
    });
  }
  return res.status(400).json({
    success: false,
    error: error?.message || "Не вдалося виконати дію",
  });
}

export async function getPublicHomepage(req, res) {
  try {
    const homepage = await HomepageContentService.getPublic({
      locale: req.query.locale,
      userId: req.auth?.userId ?? null,
    });
    return res.json({ success: true, ...homepage });
  } catch (error) {
    console.error("Помилка завантаження головної сторінки:", error);
    return res.status(500).json({
      success: false,
      error: "Не вдалося завантажити головну сторінку",
    });
  }
}

export async function listHomepageBanners(req, res) {
  try {
    return res.json({ success: true, banners: await HomepageContentService.listBanners() });
  } catch (error) {
    return fail(res, error);
  }
}

export async function createHomepageBanner(req, res) {
  try {
    const banner = await HomepageContentService.createBanner(req.body, req.files, req.auth.userId);
    return res.status(201).json({ success: true, banner });
  } catch (error) {
    return fail(res, error);
  }
}

export async function updateHomepageBanner(req, res) {
  try {
    const banner = await HomepageContentService.updateBanner(
      req.params.bannerId,
      req.body,
      req.files,
      req.auth.userId
    );
    return res.json({ success: true, banner });
  } catch (error) {
    return fail(res, error);
  }
}

export async function deleteHomepageBanner(req, res) {
  try {
    await HomepageContentService.deleteBanner(req.params.bannerId);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
}

export async function listHomepageFeatures(req, res) {
  try {
    return res.json({ success: true, features: await HomepageContentService.listFeatures() });
  } catch (error) {
    return fail(res, error);
  }
}

export async function createHomepageFeature(req, res) {
  try {
    const feature = await HomepageContentService.createFeature(req.body, req.auth.userId);
    return res.status(201).json({ success: true, feature });
  } catch (error) {
    return fail(res, error);
  }
}

export async function updateHomepageFeature(req, res) {
  try {
    const feature = await HomepageContentService.updateFeature(
      req.params.featureId,
      req.body,
      req.auth.userId
    );
    return res.json({ success: true, feature });
  } catch (error) {
    return fail(res, error);
  }
}

export async function deleteHomepageFeature(req, res) {
  try {
    await HomepageContentService.deleteFeature(req.params.featureId);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
}
