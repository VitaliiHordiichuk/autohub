import { SupplierService } from "../services/SupplierService.js";

import {
  getTxtAnalysisStatus,
  startTxtAnalysis,
  validTxtAnalysisFileId,
  TxtAnalysisJobError,
} from "../services/SpecialOrderTxtAnalysisJobService.js";

export function createTxtAnalysisAdminHandlers({
  getSupplier = id => SupplierService.getSupplier(id),
  readStatus = getTxtAnalysisStatus,
  start = startTxtAnalysis,
} = {}) {

  async function supplierAllowed(id) {
    if (String(id) !== "7") return false;

    const supplier = await getSupplier(7);

    return (
      Number(supplier?.id) === 7 &&
      /солли\s*\+\s*мерседес/i.test(
        String(supplier?.name || "")
      )
    );
  }

  function handleError(error, res) {
    if (error instanceof TxtAnalysisJobError) {
      const statuses = {
        INVALID_FILE_ID: 400,
        UPLOAD_NOT_FOUND: 404,
        INVALID_UPLOAD: 422,
        ALREADY_STARTED: 409,
        INVALID_JOB_STATE: 409,
      };

      return res.status(
        statuses[error.code] || 500
      ).json({
        success: false,
        error: error.code,
      });
    }

    if (
      String(error?.message || "").includes(
        "TXT browser upload is disabled"
      )
    ) {
      return res.status(503).json({
        success: false,
        error: "TXT_ANALYSIS_DISABLED",
      });
    }

    return res.status(500).json({
      success: false,
      error: "TXT_ANALYSIS_UNAVAILABLE",
    });
  }

  async function launch(req, res) {
    try {
      if (!await supplierAllowed(req.params.supplierId)) {
        return res.status(404).json({
          success: false,
          error: "TXT_SUPPLIER_NOT_FOUND",
        });
      }

      const fileId = req.params.fileId;

      if (!validTxtAnalysisFileId(fileId)) {
        return res.status(400).json({
          success: false,
          error: "INVALID_FILE_ID",
        });
      }

      const job = await start(fileId);

      return res.status(202).json({
        success: true,
        ...job,
      });

    } catch (error) {
      return handleError(error, res);
    }
  }

  async function status(req, res) {
    try {
      if (!await supplierAllowed(req.params.supplierId)) {
        return res.status(404).json({
          success: false,
          error: "TXT_SUPPLIER_NOT_FOUND",
        });
      }

      const fileId = req.params.fileId;

      if (!validTxtAnalysisFileId(fileId)) {
        return res.status(400).json({
          success: false,
          error: "INVALID_FILE_ID",
        });
      }

      const job = await readStatus(fileId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: "ANALYSIS_NOT_FOUND",
        });
      }

      return res.json({
        success: true,
        ...job,
      });

    } catch (error) {
      return handleError(error, res);
    }
  }

  return { launch, status };
}

export const {
  launch: launchMercedesTxtAnalysis,
  status: getMercedesTxtAnalysis,
} = createTxtAnalysisAdminHandlers();
