import { normalizeArticle } from "./articleEngine/normalize.js";
import { ArticleNumberRepository } from "../repositories/ArticleNumberRepository.js";
import { BrandAdminService } from "./BrandAdminService.js";
import { ImportFileParserService } from "./ImportFileParserService.js";

const LINK_TYPES = new Set(["ALIAS", "REPLACEMENT", "ANALOG"]);
const TYPE_NAMES = new Map([
  ["REPLACEMENT", "REPLACEMENT"], ["ЗАМЕНА", "REPLACEMENT"], ["ЗАМІНА", "REPLACEMENT"],
  ["ALIAS", "ALIAS"], ["АЛЬТЕРНАТИВА", "ALIAS"], ["ДРУГОЕ НАПИСАНИЕ", "ALIAS"], ["ІНШЕ НАПИСАННЯ", "ALIAS"],
  ["ANALOG", "ANALOG"], ["АНАЛОГ", "ANALOG"],
]);

function text(value) { return String(value ?? "").normalize("NFKC").trim(); }
function brandKey(value) { return text(value).toUpperCase().replace(/[^\p{L}\p{N}]/gu, ""); }

async function parseImportFile(file) {
  if (!file?.buffer) throw new Error("Выберите CSV или XLSX файл");
  const fileType = ImportFileParserService.detectFileType(file.originalname);
  if (!fileType) throw new Error("Поддерживаются только CSV и XLSX");
  const rawRows = await ImportFileParserService.parseFileBuffer({ buffer: file.buffer, fileType });
  if (rawRows.length < 2) throw new Error("Файл пуст или не содержит строк данных");
  if (rawRows.length > 5001) throw new Error("В одном файле допускается не более 5000 строк");

  const brands = await BrandAdminService.getBrands({ includeInactive: false });
  const brandMap = new Map();
  for (const brand of brands) {
    brandMap.set(brandKey(brand.name), brand);
    for (const alias of brand.aliases || []) brandMap.set(brandKey(alias.alias), brand);
  }

  const rows = rawRows.slice(1).map((values, index) => {
    const line = index + 2;
    const rawType = text(values[0]).toUpperCase();
    const linkType = TYPE_NAMES.get(rawType) || null;
    const sourceBrand = brandMap.get(brandKey(values[1]));
    const sourceArticle = text(values[2]);
    const targetBrand = brandMap.get(brandKey(values[3]));
    const targetArticle = text(values[4]);
    const errors = [];
    if (!linkType) errors.push("неизвестный тип связи");
    if (!sourceBrand) errors.push("неизвестный исходный бренд");
    if (!sourceArticle) errors.push("пустой исходный артикул");
    if (!targetBrand) errors.push("неизвестный связанный бренд");
    if (!targetArticle) errors.push("пустой связанный артикул");
    if (sourceBrand && targetBrand && sourceBrand.id === targetBrand.id &&
      normalizeArticle(sourceArticle) === normalizeArticle(targetArticle)) errors.push("номер связан с самим собой");
    return {
      line, linkType, sourceBrandId: sourceBrand?.id, sourceBrandName: sourceBrand?.name || text(values[1]),
      sourceArticle, targetBrandId: targetBrand?.id, targetBrandName: targetBrand?.name || text(values[3]),
      targetArticle, valid: errors.length === 0, errors,
    };
  }).filter((row) => row.sourceArticle || row.targetArticle || row.sourceBrandName || row.targetBrandName);

  return { fileName: file.originalname, rows,
    summary: { total: rows.length, valid: rows.filter(r => r.valid).length, errors: rows.filter(r => !r.valid).length } };
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}: некорректный бренд`);
  return id;
}

export const ArticleNumberAdminService = {
  async previewImport(file) { return parseImportFile(file); },

  async commitImport(file) {
    const preview = await parseImportFile(file);
    if (preview.summary.errors > 0) throw new Error(`Исправьте ошибки в файле: ${preview.summary.errors}`);
    let imported = 0;
    for (const row of preview.rows) {
      await this.create(row);
      imported++;
    }
    return { ...preview, imported };
  },
  async list(query = {}) {
    const linkType = query.linkType ? String(query.linkType).toUpperCase() : null;
    if (linkType && !LINK_TYPES.has(linkType)) throw new Error("Некорректный тип связи");
    return ArticleNumberRepository.listLinks({
      search: normalizeArticle(query.search ?? ""),
      linkType,
      includeInactive: query.includeInactive !== "false",
    });
  },

  async create(body = {}) {
    const linkType = String(body.linkType ?? "").toUpperCase();
    if (!LINK_TYPES.has(linkType)) throw new Error("Выберите тип связи");
    const sourceBrandId = positiveId(body.sourceBrandId, "Исходный номер");
    const targetBrandId = positiveId(body.targetBrandId, "Связанный номер");
    const sourceArticle = String(body.sourceArticle ?? "").trim();
    const targetArticle = String(body.targetArticle ?? "").trim();
    const sourceArticleNormalized = normalizeArticle(sourceArticle);
    const targetArticleNormalized = normalizeArticle(targetArticle);
    if (!sourceArticleNormalized || !targetArticleNormalized) throw new Error("Заполните оба артикула");
    if (sourceBrandId === targetBrandId && sourceArticleNormalized === targetArticleNormalized) {
      throw new Error("Нельзя связать номер с самим собой");
    }
    const [sourceBrand, targetBrand] = await Promise.all([
      ArticleNumberRepository.findBrandById(sourceBrandId),
      ArticleNumberRepository.findBrandById(targetBrandId),
    ]);
    if (!sourceBrand || !targetBrand) throw new Error("Один из брендов не найден");
    return ArticleNumberRepository.createLink({
      linkType, sourceBrandId, sourceArticle, sourceArticleNormalized,
      targetBrandId, targetArticle, targetArticleNormalized,
    });
  },

  async setActive(idValue, body = {}) {
    const id = positiveId(idValue, "Связь");
    if (typeof body.isActive !== "boolean") throw new Error("Передайте isActive");
    const link = await ArticleNumberRepository.setLinkActive({ id, isActive: body.isActive });
    if (!link) throw new Error("Связь не найдена");
    return link;
  },
};
