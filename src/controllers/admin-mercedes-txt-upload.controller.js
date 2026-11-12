import { unlink } from "node:fs/promises";
import { SupplierService } from "../services/SupplierService.js";
import {
  assertTxtUploadStage,
  receiveTxtFile,
  describeStagedTxtFile,
} from "../services/SpecialOrderTxtBrowserUploadService.js";

export async function uploadMercedesTxt(req, res) {
  if (req.params.supplierId !== "7") {
    return res.status(404).json({
      success: false,
      error: "TXT supplier not found",
    });
  }

  try {
    const supplier = await SupplierService.getSupplier(7);

    if (
      Number(supplier?.id) !== 7 ||
      !/солли\s*\+\s*мерседес/i.test(
        String(supplier?.name || "")
      )
    ) {
      return res.status(404).json({
        success: false,
        error: "TXT supplier not found",
      });
    }

    // Disabled unless explicitly configured for isolated testing.
    await assertTxtUploadStage();
  } catch {
    return res.status(503).json({
      success: false,
      error: "Isolated TXT upload is unavailable",
    });
  }

  receiveTxtFile(req, res, async error => {
    if (error) {
      return res.status(
        error.code === "LIMIT_FILE_SIZE" ? 413 : 400
      ).json({
        success: false,
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "TXT file exceeds upload limit"
            : "TXT file was rejected",
      });
    }

    try {
      const summary =
        await describeStagedTxtFile(req.file);

      return res.status(201).json({
        success: true,
        ...summary,
        message:
          "File stored for validation; not imported or activated",
      });
    } catch {
      if (req.file?.path) {
        await unlink(req.file.path).catch(() => {});
      }

      return res.status(422).json({
        success: false,
        error: "Unable to validate uploaded TXT file",
      });
    }
  });
}
