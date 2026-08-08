import { AdminCatalogCategoryService } from "../services/AdminCatalogCategoryService.js";

function fail(res, error) {
  console.error("Ошибка групп каталога:", error);
  return res.status(400).json({ success: false, error: error.message });
}

export async function getCatalogCategories(req, res) {
  try {
    const categories = await AdminCatalogCategoryService.listCategories();
    return res.json({ success: true, categories });
  } catch (error) {
    return fail(res, error);
  }
}

export async function getCatalogProducts(req, res) {
  try {
    const result = await AdminCatalogCategoryService.searchProducts({
      search: req.query.search,
      assignment: req.query.assignment,
      categoryId: req.query.categoryId,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error);
  }
}

export async function createCatalogCategory(req, res) {
  try {
    const category = await AdminCatalogCategoryService.createCategory({
      parentId: req.body?.parentId,
      nameUk: req.body?.nameUk,
      nameRu: req.body?.nameRu,
      nameEn: req.body?.nameEn,
    });
    return res.status(201).json({ success: true, category });
  } catch (error) {
    return fail(res, error);
  }
}

export async function updateProductCatalogCategory(req, res) {
  try {
    const categoryId = req.body?.categoryId ?? null;
    const assignment = await AdminCatalogCategoryService.setProductCategory(
      req.params.productId,
      categoryId
    );
    return res.json({ success: true, assignment });
  } catch (error) {
    return fail(res, error);
  }
}
