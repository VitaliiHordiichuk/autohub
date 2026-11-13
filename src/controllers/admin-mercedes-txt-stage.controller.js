import { SupplierService } from "../services/SupplierService.js";

import {
  assertIsolatedStageEnvironment,
  readTxtStageJob,
  validTxtStageJobId,
} from "../services/SpecialOrderTxtStageJobService.js";

import {
  launchTxtStageJob,
} from "../services/SpecialOrderTxtStageLaunchService.js";

export function createMercedesTxtStageHandlers({
  getSupplier = id => SupplierService.getSupplier(id),
  launchJob = launchTxtStageJob,
  readJob = readTxtStageJob,
  checkEnvironment = () => assertIsolatedStageEnvironment(),
} = {}) {
  async function allowed(id) {
    if (String(id) !== "7") return false;

    const supplier = await getSupplier(7);

    return (
      Number(supplier?.id) === 7 &&
      /солли\s*\+\s*мерседес/i.test(
        String(supplier?.name || "")
      )
    );
  }

  function errorResponse(res, error) {
    const code = String(error?.message || "");

    if (code === "ISOLATED_STAGE_ENVIRONMENT_REQUIRED") {
      return res.status(503).json({
        success: false,
        error: "TXT_STAGE_DISABLED",
      });
    }

    if (
      code === "STAGE_JOB_ALREADY_EXISTS" ||
      code === "STAGE_JOB_ALREADY_CLAIMED"
    ) {
      return res.status(409).json({
        success: false,
        error: "STAGE_JOB_ALREADY_EXISTS",
      });
    }

    if (error?.code === "ENOENT") {
      return res.status(404).json({
        success: false,
        error: "TXT_UPLOAD_NOT_FOUND",
      });
    }

    return res.status(500).json({
      success: false,
      error: "TXT_STAGE_UNAVAILABLE",
    });
  }

  async function launch(req, res) {
    try {
      if (!await allowed(req.params.supplierId)) {
        return res.status(404).json({
          success: false,
          error: "TXT_SUPPLIER_NOT_FOUND",
        });
      }

      if (!validTxtStageJobId(req.params.fileId)) {
        return res.status(400).json({
          success: false,
          error: "INVALID_FILE_ID",
        });
      }

      checkEnvironment();

      const job = await launchJob(req.params.fileId);

      return res.status(202).json({
        success: true,
        ...job,
      });
    } catch (error) {
      return errorResponse(res, error);
    }
  }

  async function status(req, res) {
    try {
      if (!await allowed(req.params.supplierId)) {
        return res.status(404).json({
          success: false,
          error: "TXT_SUPPLIER_NOT_FOUND",
        });
      }

      if (!validTxtStageJobId(req.params.fileId)) {
        return res.status(400).json({
          success: false,
          error: "INVALID_FILE_ID",
        });
      }

      checkEnvironment();

      const job = await readJob(req.params.fileId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: "STAGE_JOB_NOT_FOUND",
        });
      }

      return res.json({
        success: true,
        ...job,
      });
    } catch (error) {
      return errorResponse(res, error);
    }
  }

  return { launch, status };
}

export const {
  launch: launchMercedesTxtStage,
  status: getMercedesTxtStageStatus,
} = createMercedesTxtStageHandlers();
