import { ArticleNumberAdminService } from "../services/ArticleNumberAdminService.js";

function fail(res, error) {
  console.error("Ошибка управления связями артикулов:", error);
  return res.status(400).json({ success: false, error: error.message });
}

export async function getArticleNumberLinks(req, res) {
  try {
    return res.json({ success: true, links: await ArticleNumberAdminService.list(req.query) });
  } catch (error) { return fail(res, error); }
}

export async function createArticleNumberLink(req, res) {
  try {
    const link = await ArticleNumberAdminService.create(req.body);
    return res.status(201).json({ success: true, message: "Связь создана", link });
  } catch (error) { return fail(res, error); }
}

export async function updateArticleNumberLink(req, res) {
  try {
    const link = await ArticleNumberAdminService.setActive(req.params.linkId, req.body);
    return res.json({ success: true, message: "Связь обновлена", link });
  } catch (error) { return fail(res, error); }
}

export async function previewArticleNumberImport(req, res) {
  try {
    return res.json({ success: true, preview: await ArticleNumberAdminService.previewImport(req.file) });
  } catch (error) { return fail(res, error); }
}

export async function commitArticleNumberImport(req, res) {
  try {
    const result = await ArticleNumberAdminService.commitImport(req.file);
    return res.json({ success: true, message: "Файл импортирован", result });
  } catch (error) { return fail(res, error); }
}
