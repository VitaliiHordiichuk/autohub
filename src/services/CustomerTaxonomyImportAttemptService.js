import { CustomerTaxonomyImportService } from "./CustomerTaxonomyImportService.js";

// Importing an offer must not fail because its optional public classification failed.
// A savepoint also clears PostgreSQL's failed-transaction state after a SQL error.
export async function attemptCustomerTaxonomyImport({
  db,
  productId,
  context = null,
  service = CustomerTaxonomyImportService,
  logger = console,
}) {
  if (!db) throw new Error("Customer taxonomy import transaction client is required");
  await db.query("SAVEPOINT customer_taxonomy_import");
  let resolvedContext = context;
  try {
    resolvedContext ||= await service.createContext({ db });
    const taxonomy = await service.classifyProduct({
      productId,
      context: resolvedContext,
    }, { db });
    await db.query("RELEASE SAVEPOINT customer_taxonomy_import");
    return { taxonomy, context: resolvedContext, error: null };
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT customer_taxonomy_import");
    await db.query("RELEASE SAVEPOINT customer_taxonomy_import");
    logger.error("Customer taxonomy import classification failed", {
      productId,
      code: error.code || "CLASSIFICATION_ERROR",
      message: error.message,
    });
    return { taxonomy: null, context: resolvedContext, error };
  }
}
