import { SupplierService } from "../services/SupplierService.js";

import {
  validTxtStageJobId,
  readTxtStageJob,
} from "../services/SpecialOrderTxtStageJobService.js";

import {
  assertTxtUploadStage,
} from "../services/SpecialOrderTxtBrowserUploadService.js";

import {
  assertProductionTxtLaunchEnabled,
  launchProductionTxtStageJob,
} from "../services/SpecialOrderTxtProductionLaunchService.js";

export function createMercedesTxtProductionStageHandlers({
  getSupplier = id => SupplierService.getSupplier(id),
  launchJob = launchProductionTxtStageJob,
  readJob = readTxtStageJob,
  checkLaunchEnvironment = assertProductionTxtLaunchEnabled,
  checkReadEnvironment = assertTxtUploadStage,
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

    if (
      code === "STAGE_JOB_ALREADY_EXISTS" ||
      code === "STAGE_JOB_ALREADY_CLAIMED" ||
      code === "PRODUCTION_STAGE_ALREADY_CLAIMED" ||
      code === "PRODUCTION_TXT_UPLOAD_ALREADY_IMPORTED"
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

      // Import permission is checked separately from
      // read-only status access.
      try {
        checkLaunchEnvironment();
      } catch {
        return res.status(503).json({
          success: false,
          error: "TXT_STAGE_DISABLED",
        });
      }

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

      // Reading a prior job does not require the
      // production import flag to be enabled.
      // Production storage protection still applies.
      try {
        await checkReadEnvironment();
      } catch {
        return res.status(503).json({
          success: false,
          error: "TXT_STAGE_DISABLED",
        });
      }

      const job = await readJob(req.params.fileId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: "STAGE_JOB_NOT_FOUND",
        });
      }

      return res.status(200).json({
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
} = createMercedesTxtProductionStageHandlers();
