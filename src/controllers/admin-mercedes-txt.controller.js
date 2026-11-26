import { readTxtAdminWorkflow } from "../services/SpecialOrderTxtAdminWorkflowService.js";
import { pool } from "../config/db.js";
import { SupplierService } from "../services/SupplierService.js";
import {
  listMercedesTxtRevisions,
  activateMercedesTxtRevision,
} from "../services/SpecialOrderAdminRevisionService.js";

const SUPPLIER_ID = 7;
const SOURCE_KEY = "mercedes-txt";

export function createMercedesTxtAdminHandlers({
  getSupplier = id => SupplierService.getSupplier(id),
  connect = () => pool.connect(),
  listRevisions = listMercedesTxtRevisions,
  activateRevision = activateMercedesTxtRevision,
  readWorkflow = readTxtAdminWorkflow,
} = {}) {
  async function checkSupplier(id) {
    if (String(id) !== String(SUPPLIER_ID)) return false;

    const supplier = await getSupplier(SUPPLIER_ID);

    return Number(supplier?.id) === SUPPLIER_ID &&
      /солли\s*\+\s*мерседес/i.test(
        String(supplier?.name || "")
      );
  }

  async function list(req, res) {
    try {
      if (!await checkSupplier(req.params.supplierId)) {
        return res.status(404).json({
          success: false,
          error: "TXT source not found for supplier",
        });
      }

      const db = await connect();

      try {
        const revisions = await listRevisions(db);

        return res.json({
          success: true,
          supplierId: SUPPLIER_ID,
          sourceKey: SOURCE_KEY,
          revisions,
        });
      } finally {
        db.release();
      }
    } catch {
      return res.status(500).json({
        success: false,
        error: "Unable to retrieve TXT revisions",
      });
    }
  }

  async function activate(req, res) {
    try {
      if (!await checkSupplier(req.params.supplierId)) {
        return res.status(404).json({
          success: false,
          error: "TXT source not found for supplier",
        });
      }

      const rawId = req.body?.importId;

      if (
        !/^[1-9]\d*$/.test(String(rawId ?? "")) ||
        !Number.isSafeInteger(Number(rawId))
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid import ID",
        });
      }

      const db = await connect();

      try {
        const result = await activateRevision({
          db,
          importId: Number(rawId),
        });

        return res.json({
          success: true,
          result,
        });
      } finally {
        db.release();
      }
    } catch (error) {
      const message = String(error?.message || "");
      const disabled = message === "TXT_ACTIVATION_DISABLED";
      const reconciliation = message === "TXT_RECONCILIATION_REQUIRED";

      const busy = message.includes(
        "TXT import currently in progress"
      );

      const invalidRevision =
        /not ready|no valid entries|row count mismatch/i
          .test(message);

      return res.status(
        disabled ? 423 : busy ? 423 : reconciliation ? 409 : invalidRevision ? 409 : 500
      ).json({
        success: false,
        error: disabled
          ? "TXT_ACTIVATION_DISABLED"
          : busy
            ? "TXT import is in progress"
            : reconciliation
              ? "TXT_RECONCILIATION_REQUIRED"
            : invalidRevision
              ? "TXT revision cannot be activated"
              : "TXT activation failed",
      });
    }
  }

  async function workflow(req, res) {
    try {
      if (!await checkSupplier(req.params.supplierId)) return res.status(404).json({success:false,error:"TXT_SUPPLIER_NOT_FOUND"});
      if (req.query?.fileId !== undefined && (typeof req.query.fileId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.query.fileId))) return res.status(400).json({success:false,error:"INVALID_FILE_ID"});
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, sourceKey: SOURCE_KEY, ...await readWorkflow(req.query?.fileId) });
    } catch { return res.status(503).json({success:false,error:"TXT_WORKFLOW_UNAVAILABLE"}); }
  }

  return { list, activate, workflow };
}

export const {
  workflow: getMercedesTxtAdminWorkflow,
  list: listMercedesTxtAdminRevisions,
  activate: activateMercedesTxtAdminRevision,
} = createMercedesTxtAdminHandlers();
