import { AdminCustomerTaxonomyService } from "../services/AdminCustomerTaxonomyService.js";
import { CustomerTaxonomyAssignmentService } from "../services/CustomerTaxonomyAssignmentService.js";

function failure(res, error) {
  const status = Number(error?.statusCode) || 500;
  if (status >= 500) console.error("Customer taxonomy admin preview failed:", error);
  return res.status(status).json({
    success: false,
    error: status >= 500 ? "Не вдалося завантажити customer taxonomy" : error.message,
  });
}

export async function getCustomerTaxonomyOverview(req, res) {
  try {
    const overview = await AdminCustomerTaxonomyService.getOverview({ locale: req.query.locale });
    return res.json({ success: true, ...overview });
  } catch (error) {
    return failure(res, error);
  }
}

export async function getCustomerTaxonomyProducts(req, res) {
  try {
    const result = await AdminCustomerTaxonomyService.searchProducts({
      ...req.query,
      categorySlug: req.params.categorySlug || req.query.categorySlug,
      pageSize: req.query.pageSize || req.query.limit,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return failure(res, error);
  }
}

export async function getCustomerTaxonomyProduct(req, res) {
  try {
    const result = await AdminCustomerTaxonomyService.getProductDetails(
      req.params.productId,
      { locale: req.query.locale },
    );
    return res.json({ success: true, ...result });
  } catch (error) {
    return failure(res, error);
  }
}

export async function assignCustomerTaxonomySubgroup(req, res) {
  try {
    const assignment = await CustomerTaxonomyAssignmentService.assignManual({
      productId: req.params.productId,
      customerCategoryId: req.body?.customerCategoryId,
      isPrimary: true,
      approvedBy: req.auth.userId,
    });
    return res.json({ success: true, assignment });
  } catch (error) {
    return failure(res, error);
  }
}
