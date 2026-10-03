import { AdminCustomerTaxonomyRepository } from "../repositories/AdminCustomerTaxonomyRepository.js";

const locales = new Set(["uk", "ru", "en"]);
const pageSizes = new Set([25, 50, 100]);
const filters = {
  assignmentSource: new Set(["MANUAL", "RULE", "EPC_FALLBACK"]),
  assignmentOrigin: new Set(["ADMIN", "IMPORT", "BACKFILL", "MIGRATION", "SYSTEM"]),
  confidence: new Set(["HIGH", "MEDIUM", "LOW"]),
  approvalStatus: new Set(["AUTO_APPROVED", "REVIEW", "MANUAL_APPROVED", "REJECTED"]),
  numberFamily: new Set(["A", "N", "B", "OTHER"]),
};

function locale(value) {
  const normalized = String(value || "uk").trim().toLowerCase();
  return locales.has(normalized) ? normalized : "uk";
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalEnum(name, value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return null;
  if (!filters[name].has(normalized)) {
    const error = new Error(`Invalid ${name}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function optionalText(value, maxLength) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function categorySlug(value) {
  const normalized = optionalText(value, 160);
  if (!normalized) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    const error = new Error("Invalid category slug");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}

export const AdminCustomerTaxonomyService = {
  async getOverview({ locale: requestedLocale } = {}, {
    repository = AdminCustomerTaxonomyRepository,
    db,
  } = {}) {
    const selectedLocale = locale(requestedLocale);
    const [categories, integrity] = await Promise.all([
      repository.listTree(selectedLocale, db),
      repository.getIntegrity(db),
    ]);
    return { locale: selectedLocale, categories, integrity };
  },

  async searchProducts(input = {}, {
    repository = AdminCustomerTaxonomyRepository,
    db,
  } = {}) {
    const page = positiveInteger(input.page, 1);
    const requestedPageSize = positiveInteger(input.pageSize, 50);
    const pageSize = pageSizes.has(requestedPageSize) ? requestedPageSize : 50;
    const search = optionalText(input.search, 200);
    const query = {
      locale: locale(input.locale),
      categorySlug: categorySlug(input.categorySlug),
      searchPattern: search ? `%${escapeLike(search)}%` : null,
      assignmentSource: optionalEnum("assignmentSource", input.assignmentSource),
      assignmentOrigin: optionalEnum("assignmentOrigin", input.assignmentOrigin),
      confidence: optionalEnum("confidence", input.confidence),
      approvalStatus: optionalEnum("approvalStatus", input.approvalStatus),
      ruleCode: optionalText(input.ruleCode, 120),
      numberFamily: optionalEnum("numberFamily", input.numberFamily),
      epcGroup: optionalText(input.epcGroup, 10)?.toUpperCase() || null,
      page,
      pageSize,
    };
    const result = await repository.searchProducts(query, db);
    const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
    return {
      products: result.rows,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages,
        hasPrevious: page > 1,
        hasNext: page < totalPages,
      },
    };
  },

  async getProductDetails(productIdValue, { locale: requestedLocale } = {}, {
    repository = AdminCustomerTaxonomyRepository,
    db,
  } = {}) {
    const productId = positiveInteger(productIdValue, null);
    if (!productId) {
      const error = new Error("Invalid product id");
      error.statusCode = 400;
      throw error;
    }
    const rows = await repository.getProductDetails(productId, locale(requestedLocale), db);
    if (!rows.length) {
      const error = new Error("Customer taxonomy product not found");
      error.statusCode = 404;
      throw error;
    }
    return {
      product: {
        id: rows[0].productId,
        article: rows[0].article,
        name: rows[0].name,
        numberFamily: rows[0].numberFamily,
        technicalEpcGroup: rows[0].technicalEpcGroup,
        technicalCategories: rows[0].technicalCategories,
        customerClassifications: rows.map((row) => ({
          customerCategory: row.customerCategory,
          assignmentSource: row.assignmentSource,
          assignmentOrigin: row.assignmentOrigin,
          ruleCode: row.ruleCode,
          ruleVersion: row.ruleVersion,
          ruleNumberFamily: row.ruleNumberFamily,
          ruleEpcGroup: row.ruleEpcGroup,
          confidence: row.confidence,
          approvalStatus: row.approvalStatus,
          isPrimary: row.isPrimary,
          assignedAt: row.assignedAt,
        })),
      },
    };
  },
};
